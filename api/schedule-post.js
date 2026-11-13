const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { snapshotOf, contentKey, settle, settleForDrafts } = require('./_delivery')

// Everything below the media/caption handling is built against Metricool's
// real API, verified live rather than assumed -- see the Schedule feature's
// build history for how each piece was confirmed. Two things worth
// restating here since they're easy to get subtly wrong:
//
// 1. Media can't be handed to the post-creation call as a raw Dropbox
//    link, even a valid one -- Metricool's own docs confirm private or
//    temporary URLs get silently skipped. The real flow is two calls:
//    normalize the source URL first (Metricool fetches it immediately and
//    hosts its own permanent copy), then use THAT url in the post payload.
//
// 2. There is no per-network caption-override field on the payload. When
//    captions diverge, Metricool's own composer sends one SEPARATE API
//    call per distinct caption, each with its own `providers` array
//    holding only the platforms that share that exact text. Confirmed by
//    scheduling a real test post with divergent Facebook/LinkedIn text and
//    reading back exactly what got created: two independent posts, same
//    publish time, different `providers` and different `text` each. Two
//    more plausible-looking field names (`linkedinData.text`,
//    `providers[].text`) were tried first and silently ignored by the
//    API -- no error, just dropped -- which is why this was verified
//    against a live response rather than left as a guess.

async function getDropboxAccessToken() {
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET
    })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`Dropbox token refresh failed: ${JSON.stringify(data)}`)
  return data.access_token
}

async function getDropboxTemporaryLink(path) {
  const token = await getDropboxAccessToken()
  const res = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Missing this on the first real attempt produced a confusing
      // path/not_found for a path that was completely valid -- client
      // files live in a specific Dropbox team namespace, not whatever
      // namespace this token resolves to by default, and Dropbox has no
      // way to know that without being told explicitly. Matches the
      // namespace id api/dropbox.js already uses for every other Dropbox
      // call in this app.
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'namespace_id',
        namespace_id: '13502300579'
      })
    },
    body: JSON.stringify({ path })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Dropbox temporary link failed: ${JSON.stringify(data)}`)
  return data.link
}

// Response shape for normalize is taken from Metricool's documented
// description ("returns the URL of the copy") rather than a live-captured
// response. Confirmed against a real failure: this does NOT return JSON --
// it returns the bare URL as plain text, no quotes, no wrapper object.
// Reading it as text first and only trying JSON as a fallback (in case
// Metricool ever wraps it differently for a different media type) instead
// of assuming a shape that turned out to be wrong the first time this ran
// for real.
// Confirmed against a real Metricool rejection: publicationDate.dateTime
// must include seconds ('yyyy-MM-dd'T'HH:mm:ss'), but the browser's
// datetime-local input hands back "2026-09-11T08:31" with no seconds --
// which is exactly what got saved to publish_date, since the occurrence
// stores that value as-typed on purpose (see Schedule.jsx: it deliberately
// avoids any timezone conversion by keeping the raw wall-clock string).
// Normalizing here, at the point this actually gets sent, rather than
// changing what's stored -- the display value and the save format are
// still correct for their own purposes, they just need :00 appended
// before Metricool will accept them.
function toMetricoolDateTime(value) {
  if (!value) return value
  return value.length === 16 ? `${value}:00` : value
}

async function normalizeMedia(sourceUrl) {
  const params = new URLSearchParams({ url: sourceUrl })
  const res = await fetch(`https://app.metricool.com/api/actions/normalize/image/url?${params}`, {
    headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
  })
  const raw = await res.text()

  if (!res.ok) throw new Error(`Media normalize failed: ${raw}`)

  const trimmed = raw.trim()
  if (trimmed.startsWith('http')) return trimmed

  try {
    const data = JSON.parse(trimmed)
    const url = data.url || data.link || (typeof data === 'string' ? data : null)
    if (url) return url
    throw new Error(`Normalize returned an unrecognized JSON shape: ${trimmed}`)
  } catch (err) {
    throw new Error(`Normalize returned an unrecognized response: ${trimmed}`)
  }
}

// Groups an occurrence's checked platforms by their FINAL caption text --
// template unless a platform has its own override. Platforms landing in
// the same group become one Metricool API call with multiple providers;
// platforms in a different group become their own separate call. This is
// the direct implementation of the confirmed behavior above.
function buildCaptionGroups(occurrence) {
  const groups = new Map()
  for (const platform of occurrence.platforms || []) {
    const text = occurrence.platform_captions?.[platform] ?? occurrence.caption
    if (!groups.has(text)) groups.set(text, [])
    groups.get(text).push(platform)
  }
  return Array.from(groups.entries()).map(([text, platforms]) => ({ text, platforms }))
}

// Per-network settings blocks, sourced from the occurrence's own saved
// fields -- these are the exact field names confirmed live against real
// posts earlier in this feature's build (ig_post_type -> instagramData.type,
// etc). YouTube is deliberately scoped to Shorts only: long-form video is
// always published natively outside this tool, so there's no long-form
// path to build here, and `type` is hardcoded rather than taken from the
// occurrence.
function buildNetworkData(platform, occurrence) {
  switch (platform) {
    case 'instagram':
      return {
        instagramData: {
          type: occurrence.ig_post_type || 'POST',
          ...(occurrence.ig_post_type === 'REEL' ? { showReelOnFeed: occurrence.ig_show_reel_on_feed ?? true } : {})
        }
      }
    case 'facebook':
      return { facebookData: { type: occurrence.fb_post_type || 'POST' } }
    case 'tiktok':
      return { tiktokData: { privacyOption: occurrence.tiktok_privacy || 'PUBLIC_TO_EVERYONE' } }
    case 'youtube':
      return {
        youtubeData: {
          title: occurrence.yt_title || occurrence.filename,
          type: 'short',
          privacy: occurrence.yt_privacy || 'public',
          madeForKids: occurrence.yt_made_for_kids ?? false,
          ...(occurrence.yt_category ? { category: occurrence.yt_category } : {})
        }
      }
    case 'linkedin':
      return { linkedinData: { type: 'POST' } }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Replacing a post that is already scheduled (Session 4).
//
// Clicking Schedule again on a scheduled post used to create a SECOND post in
// Metricool next to the first. Now the old Metricool posts are deleted first,
// then the post is created fresh. Delete and re-create rather than Metricool's
// PUT, because a caption change can regroup platforms (see note 2 above):
// one post can become two, or two can become one, which PUT cannot express.
//
// Order is delete first, then create. If the create then fails, the post is
// marked failed and shows Retry: a missing post is visible and fixable. The
// other order risks a duplicate public post, which is not.
//
// Before deleting, each post is read back. If any network already shows
// PUBLISHED, nothing is deleted: a live post cannot be changed from here.
// ---------------------------------------------------------------------------

function metricoolParams(blogId) {
  return new URLSearchParams({ blogId: String(blogId), userId: process.env.METRICOOL_USER_ID })
}

function postIdsOf(occurrence) {
  return [...new Set(Object.values(occurrence.metricool_post_ids || {}).map(String))]
}

async function getPost(blogId, id) {
  const r = await fetch(`https://app.metricool.com/api/v2/scheduler/posts/${id}?${metricoolParams(blogId)}`, {
    headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { /* keep text */ }
  return { status: r.status, ok: r.ok, post: json && (json.data || json), text }
}

async function anyPublished(blogId, ids) {
  for (const id of ids) {
    const g = await getPost(blogId, id)
    if (g.ok && ((g.post && g.post.providers) || []).some(p => p.status === 'PUBLISHED')) return true
  }
  return false
}

// Delete, then read each post back to confirm it is really gone. A delete
// that "succeeds" but leaves the post in Metricool is reported, not trusted.
async function deletePosts(blogId, ids) {
  const failures = []
  for (const id of ids) {
    const r = await fetch(`https://app.metricool.com/api/v2/scheduler/posts/${id}?${metricoolParams(blogId)}`, {
      method: 'DELETE',
      headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
    })
    const body = (await r.text()).slice(0, 200)
    if (!r.ok && r.status !== 404) { failures.push(`${id}: delete ${r.status} ${body}`); continue }
    const after = await getPost(blogId, id)
    if (after.ok && after.post && (after.post.providers || []).length) {
      failures.push(`${id}: delete answered ${r.status} but the post is still in Metricool`)
    }
  }
  return failures
}

const NO_ID_MESSAGE = 'No Metricool id was saved for this post, so the portal cannot find it in Metricool. Delete the post in Metricool yourself, then click Retry here to schedule the new version.'

// After a post is sent again, update every delivery item that holds it.
// If the caption, platforms or post type changed, the client sees it again.
async function syncDeliveryItems(occurrence, newIds) {
  const { data: items } = await supabaseAdmin
    .from('review_cycle_items')
    .select('id, cycle_id, review_status, content_key, filename')
    .eq('schedule_draft_id', occurrence.id)
  const key = contentKey(occurrence)
  const returned = []
  for (const item of items || []) {
    const patch = { metricool_ids: newIds }
    if (item.content_key !== key) {
      // Any change the client would see goes back to them, and they are told,
      // whether or not they had responded yet. They may already have looked.
      patch.content_key = key
      patch.review_status = 'awaiting'
      patch.reviewed_at = null
      returned.push({ cycleId: item.cycle_id, filename: item.filename })
    }
    await supabaseAdmin.from('review_cycle_items').update(patch).eq('id', item.id)
    if (patch.review_status === 'awaiting') {
      await supabaseAdmin.from('file_comments').update({ resolved: true })
        .eq('item_id', item.id).eq('sender_role', 'member')
      const { data: cycle } = await supabaseAdmin.from('review_cycles').select('*').eq('id', item.cycle_id).maybeSingle()
      if (cycle) await settle(supabaseAdmin, cycle, { reopen: true })
    }
  }
  return returned
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  // Scheduling real, public-facing content is a higher-stakes action than
  // most of what admin/editor already covers elsewhere in this app, so
  // this checks role explicitly rather than relying only on RLS on the
  // schedule_drafts table (which governs reading/writing the draft, not
  // this endpoint's own right to act on it).
  const { data: roleRow } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()
  if (!roleRow || !['admin', 'editor'].includes(roleRow.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { occurrenceId } = req.body || {}
  if (!occurrenceId) return res.status(400).json({ error: 'occurrenceId required' })

  const { data: occurrence, error: fetchError } = await supabaseAdmin
    .from('schedule_drafts')
    .select('*, clients(metricool_blog_id, name)')
    .eq('id', occurrenceId)
    .single()

  if (fetchError || !occurrence) return res.status(404).json({ error: 'Draft not found' })
  if (!occurrence.clients?.metricool_blog_id) {
    return res.status(400).json({ error: 'This client has no Metricool blog connected' })
  }

  const blogId = occurrence.clients.metricool_blog_id
  const oldIds = occurrence.status === 'scheduled' ? postIdsOf(occurrence) : []

  // ---------- pull: take a scheduled post off the calendar ----------
  if ((req.body || {}).action === 'pull') {
    if (occurrence.status !== 'scheduled') return res.status(400).json({ error: 'Only a scheduled post can be pulled.' })
    if (!oldIds.length) {
      return res.status(409).json({ error: 'No Metricool id was saved for this post, so it cannot be pulled from here. Delete it in Metricool.' })
    }
    try {
      if (oldIds.length && await anyPublished(blogId, oldIds)) {
        await supabaseAdmin.from('schedule_drafts').update({ status: 'published', active: false }).eq('id', occurrenceId)
        await settleForDrafts(supabaseAdmin, [occurrenceId])
        return res.status(409).json({ error: 'This post has already gone live, so it cannot be pulled from here.' })
      }
      const failures = await deletePosts(blogId, oldIds)
      if (failures.length) {
        await supabaseAdmin.from('schedule_drafts').update({ schedule_error: 'Pull failed: ' + failures.join(' | ') }).eq('id', occurrenceId)
        return res.status(502).json({ error: 'Metricool did not remove the post. Check it in Metricool.', failures })
      }
      await supabaseAdmin.from('schedule_drafts').update({
        status: 'cancelled', active: false, metricool_post_ids: {}, schedule_error: null
      }).eq('id', occurrenceId)
      await supabaseAdmin.from('review_cycle_items').update({ metricool_ids: [] }).eq('schedule_draft_id', occurrenceId)
      await settleForDrafts(supabaseAdmin, [occurrenceId])
      return res.status(200).json({ success: true, pulled: true })
    } catch (err) {
      console.error('pull error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  if (occurrence.status === 'scheduled' && !oldIds.length) {
    await supabaseAdmin.from('schedule_drafts').update({ status: 'failed', schedule_error: NO_ID_MESSAGE }).eq('id', occurrenceId)
    return res.status(409).json({ error: NO_ID_MESSAGE })
  }

  try {
    // Replacing an already scheduled post: check it has not gone live, then
    // remove the old Metricool posts before creating the new ones.
    if (oldIds.length) {
      if (await anyPublished(blogId, oldIds)) {
        await supabaseAdmin.from('schedule_drafts').update({ status: 'published', active: false }).eq('id', occurrenceId)
        await settleForDrafts(supabaseAdmin, [occurrenceId])
        return res.status(409).json({ error: 'This post has already gone live. Changes to a live post have to be made on the platform itself.' })
      }
      const failures = await deletePosts(blogId, oldIds)
      if (failures.length) {
        await supabaseAdmin.from('schedule_drafts').update({ schedule_error: 'Update stopped, the old post could not be removed: ' + failures.join(' | ') }).eq('id', occurrenceId)
        return res.status(502).json({ error: 'Metricool did not remove the old post, so nothing was changed. Check it in Metricool.', failures })
      }
    }

    // Media is the same file regardless of how many separate posts this
    // occurrence turns into, so it's normalized once and reused across
    // every caption group below.
    const tempLink = await getDropboxTemporaryLink(occurrence.dropbox_path)
    const normalizedMediaUrl = await normalizeMedia(tempLink)

    const groups = buildCaptionGroups(occurrence)
    const networkToPostId = {}
    const errors = []

    for (const group of groups) {
      const payload = {
        publicationDate: {
          dateTime: toMetricoolDateTime(occurrence.publish_date),
          timezone: occurrence.timezone || 'America/New_York'
        },
        text: group.text,
        providers: group.platforms.map(network => ({ network })),
        media: [normalizedMediaUrl],
        mediaAltText: occurrence.media_alt_text || undefined,
        videoCoverMilliseconds: occurrence.video_cover_ms ?? undefined,
        // Was false as an initial safety default before either side of
        // this build understood Metricool's per-platform behavior. Turns
        // out that default was actively harmful for Instagram specifically:
        // confirmed live that Facebook publishes fine regardless, but
        // Instagram without autoPublish sits in a "sent, not actually
        // published" limbo that Metricool's own status field nonetheless
        // reports as "PUBLISHED" -- a real, confirmed-by-their-own-support
        // false positive. The review step this tool is actually built
        // around already happens before Schedule gets clicked (caption,
        // platforms, date all deliberately set), so gating a second manual
        // publish click inside Metricool afterward wasn't adding real
        // safety, just adding a step that silently broke Instagram.
        autoPublish: true,
        draft: false,
      }
      for (const platform of group.platforms) {
        Object.assign(payload, buildNetworkData(platform, occurrence))
      }

      const params = new URLSearchParams({
        blogId: String(occurrence.clients.metricool_blog_id),
        userId: process.env.METRICOOL_USER_ID
      })
      const postRes = await fetch(`https://app.metricool.com/api/v2/scheduler/posts?${params}`, {
        method: 'POST',
        headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      // Read as text first, same reason as normalizeMedia above: a real
      // LinkedIn attempt once came back with a body starting "<JsonError",
      // not JSON at all -- calling .json() directly on that produced an
      // opaque "Unexpected token '<'" instead of showing what Metricool
      // actually said. A same-shaped retry immediately after succeeded
      // cleanly, so this looks like a transient gateway hiccup on their
      // end rather than anything wrong with the payload -- but the next
      // time something like it happens, the raw response should be
      // visible in schedule_error instead of a parse-error message that
      // hides it.
      const postRaw = await postRes.text()
      let postData
      try {
        postData = JSON.parse(postRaw)
      } catch (err) {
        errors.push(`${group.platforms.join('+')}: non-JSON response (${postRes.status}): ${postRaw.slice(0, 300)}`)
        continue
      }

      if (!postRes.ok) {
        errors.push(`${group.platforms.join('+')}: ${JSON.stringify(postData)}`)
        continue
      }
      // Metricool has answered both as { id } and as { data: { id } }. Reading
      // only postData.id saved nothing for the wrapped form, which left the
      // portal unable to find the post again (Pull and Update did nothing).
      const newId = postData.id ?? postData.data?.id ?? postData.data?.[0]?.id
      if (newId === undefined || newId === null) {
        errors.push(`${group.platforms.join('+')}: scheduled, but Metricool returned no post id: ${postRaw.slice(0, 300)}`)
        continue
      }
      for (const platform of group.platforms) networkToPostId[platform] = newId
    }

    const fullyFailed = errors.length > 0 && errors.length === groups.length
    await supabaseAdmin
      .from('schedule_drafts')
      .update({
        status: fullyFailed ? 'failed' : 'scheduled',
        metricool_post_ids: networkToPostId,
        schedule_error: errors.length > 0 ? errors.join(' | ') : null,
        scheduled_at: new Date().toISOString(),
        scheduled_snapshot: fullyFailed ? null : snapshotOf(occurrence),
      })
      .eq('id', occurrenceId)

    const newIds = [...new Set(Object.values(networkToPostId).map(String))]
    // A post that already went out and is being posted again is a new post,
    // not a change to the one the client reviewed, so deliveries are left alone.
    let returnedForReview = []
    if (occurrence.status !== 'published') {
      if (fullyFailed) {
        if (oldIds.length) await supabaseAdmin.from('review_cycle_items').update({ metricool_ids: [] }).eq('schedule_draft_id', occurrenceId)
      } else {
        returnedForReview = await syncDeliveryItems(occurrence, newIds)
      }
    }

    return res.status(fullyFailed ? 500 : 200).json({
      success: !fullyFailed,
      replaced: oldIds.length > 0,
      networkToPostId,
      returnedForReview,
      errors
    })
  } catch (err) {
    console.error('schedule-post error:', err)
    await supabaseAdmin
      .from('schedule_drafts')
      .update({ status: 'failed', schedule_error: err.message })
      .eq('id', occurrenceId)
    return res.status(500).json({ error: err.message })
  }
}
