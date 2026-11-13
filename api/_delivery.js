// api/_delivery.js
//
// Shared rules for bank deliveries, used by delivery.js, schedule-post.js
// and the metricool-analytics cron. Keep the rules here, not in each file.

// Fields that are sent to Metricool for a post. If any of these changed
// since the last send, the post has unsent changes.
const POST_FIELDS = [
  'caption', 'platform_captions', 'platforms', 'publish_date', 'timezone',
  'ig_post_type', 'ig_show_reel_on_feed', 'fb_post_type', 'yt_title', 'yt_privacy',
  'yt_made_for_kids', 'yt_category', 'tiktok_privacy', 'video_cover_ms', 'media_alt_text', 'dropbox_path'
]

// The same list minus the date. A change to these sends a post back to the
// client for review; moving the date alone does not.
const REVIEW_FIELDS = POST_FIELDS.filter(f => f !== 'publish_date' && f !== 'timezone')

function norm(v) {
  if (v === undefined || v === '') return null
  if (Array.isArray(v)) return [...v].sort()
  if (v && typeof v === 'object') {
    const out = {}
    Object.keys(v).sort().forEach(k => { if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k] })
    return out
  }
  return v
}

function snapshotOf(draft) {
  const out = {}
  POST_FIELDS.forEach(f => { out[f] = norm(draft[f]) })
  return out
}

function contentKey(draft) {
  const out = {}
  REVIEW_FIELDS.forEach(f => { out[f] = norm(draft[f]) })
  return JSON.stringify(out)
}

// An item needs nothing more from the client once it is approved, or once
// its post has gone out or been pulled.
function itemDone(item, draft) {
  if (item.review_status === 'approved') return true
  if (item.schedule_draft_id) {
    if (!draft) return true
    if (draft.status === 'published' || draft.status === 'cancelled') return true
  }
  return false
}

// Recompute a delivery's stage, and close it when nothing is left to review.
// Returns { total, done, closed } where closed is true only when this call closed it.
// A closed delivery is only reopened when opts.reopen is set (a file or post
// was sent back for review). Otherwise a delivery the team closed stays closed.
async function settle(supabase, cycle, opts) {
  const reopen = !!(opts && opts.reopen)
  const { data: items } = await supabase
    .from('review_cycle_items').select('id, review_status, schedule_draft_id').eq('cycle_id', cycle.id)
  const list = items || []
  const draftIds = list.map(i => i.schedule_draft_id).filter(Boolean)
  const drafts = {}
  if (draftIds.length) {
    const { data } = await supabase.from('schedule_drafts').select('id, status').in('id', draftIds)
    ;(data || []).forEach(d => { drafts[d.id] = d })
  }
  const done = list.filter(i => itemDone(i, drafts[i.schedule_draft_id])).length
  const total = list.length

  if (total > 0 && done === total) {
    const closing = !cycle.resolved_at
    await supabase.from('review_cycles')
      .update({ stage: 'approved', resolved_at: cycle.resolved_at || new Date().toISOString() })
      .eq('id', cycle.id)
    return { total, done, closed: closing }
  }

  if (cycle.resolved_at && !reopen) return { total, done, closed: false }

  const open = list.some(i => i.review_status === 'changes_requested' && !itemDone(i, drafts[i.schedule_draft_id]))
  await supabase.from('review_cycles')
    .update({ stage: open ? 'revisions' : 'in_review', resolved_at: null })
    .eq('id', cycle.id)
  return { total, done, closed: false }
}

// Settle every delivery that holds one of these posts.
async function settleForDrafts(supabase, draftIds, opts) {
  if (!draftIds || !draftIds.length) return []
  const { data: items } = await supabase
    .from('review_cycle_items').select('cycle_id').in('schedule_draft_id', draftIds)
  const cycleIds = [...new Set((items || []).map(i => i.cycle_id))]
  const out = []
  for (const id of cycleIds) {
    const { data: cycle } = await supabase.from('review_cycles').select('*').eq('id', id).maybeSingle()
    if (cycle) out.push({ cycleId: id, ...(await settle(supabase, cycle, opts)) })
  }
  return out
}

module.exports = { POST_FIELDS, snapshotOf, contentKey, itemDone, settle, settleForDrafts }
