const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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
// response -- the live verification this session focused on media
// REQUIRING normalization and the caption-grouping behavior, both of
// which directly change how this feature had to be built. This endpoint's
// exact response shape is the one remaining piece worth confirming against
// a real call before fully trusting it; handled defensively below in the
// meantime so a differently-shaped response doesn't silently produce
// `undefined` in the media field.
async function normalizeMedia(sourceUrl) {
  const params = new URLSearchParams({ url: sourceUrl })
  const res = await fetch(`https://app.metricool.com/api/actions/normalize/image/url?${params}`, {
    headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Media normalize failed: ${JSON.stringify(data)}`)
  const url = data.url || data.link || (typeof data === 'string' ? data : null)
  if (!url) throw new Error(`Normalize returned an unrecognized shape: ${JSON.stringify(data)}`)
  return url
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

  try {
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
          dateTime: occurrence.publish_date,
          timezone: occurrence.timezone || 'America/New_York'
        },
        text: group.text,
        providers: group.platforms.map(network => ({ network })),
        media: [normalizedMediaUrl],
        mediaAltText: occurrence.media_alt_text || undefined,
        videoCoverMilliseconds: occurrence.video_cover_ms ?? undefined,
        // Safety default rather than a convenience one: this schedules the
        // post on Metricool without instructing it to auto-publish, so a
        // freshly-scheduled batch doesn't go live unattended the first
        // time this button is used for real. Worth revisiting once this
        // has been trusted in practice for a while.
        autoPublish: false,
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
      const postData = await postRes.json()

      if (!postRes.ok) {
        errors.push(`${group.platforms.join('+')}: ${JSON.stringify(postData)}`)
        continue
      }
      for (const platform of group.platforms) networkToPostId[platform] = postData.id
    }

    const fullyFailed = errors.length > 0 && errors.length === groups.length
    await supabaseAdmin
      .from('schedule_drafts')
      .update({
        status: fullyFailed ? 'failed' : 'scheduled',
        metricool_post_ids: networkToPostId,
        schedule_error: errors.length > 0 ? errors.join(' | ') : null,
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', occurrenceId)

    return res.status(fullyFailed ? 500 : 200).json({
      success: !fullyFailed,
      networkToPostId,
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
