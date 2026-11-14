// src/lib/postSnapshot.js
//
// Browser copy of the field list in api/_delivery-rules.js (POST_FIELDS). Used only
// to show "Unsent changes" in the Content Bank: a scheduled post whose fields
// no longer match what was last sent to Metricool. If you add a field to one
// list, add it to the other.

const POST_FIELDS = [
  'caption', 'platform_captions', 'platforms', 'publish_date', 'timezone',
  'ig_post_type', 'ig_show_reel_on_feed', 'fb_post_type', 'yt_title', 'yt_privacy',
  'yt_made_for_kids', 'yt_category', 'tiktok_privacy', 'video_cover_ms', 'media_alt_text', 'dropbox_path'
]

function norm(v) {
  if (v === undefined || v === '') return null
  // Dates come back with or without seconds; compare to the minute.
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) return v.slice(0, 16)
  if (Array.isArray(v)) return [...v].sort()
  if (v && typeof v === 'object') {
    const out = {}
    Object.keys(v).sort().forEach(k => { if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k] })
    return out
  }
  return v
}

export function hasUnsentChanges(occ) {
  if (occ.status !== 'scheduled' || !occ.scheduled_snapshot) return false
  return POST_FIELDS.some(f => JSON.stringify(norm(occ[f])) !== JSON.stringify(norm(occ.scheduled_snapshot[f])))
}
