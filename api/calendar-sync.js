// api/calendar-sync.js
//
// Dry-run version of the calendar sync currently running in Make.com. Pulls
// each client's live Metricool schedule (same scheduler/posts endpoint and
// auth pattern as api/metricool.js), computes what row it WOULD write for
// each post, and logs that comparison into calendar_sync_preview — it does
// NOT touch calendar_events. Make.com stays the only thing writing real
// data until this has been checked against its output across a few runs.
//
// To go live once verified: flip DRY_RUN to false below, which enables the
// real upsert block that's currently commented out. That's the only change
// needed — nothing else about this function changes between dry-run and live.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DRY_RUN = false

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const userId = process.env.METRICOOL_USER_ID
  const token = process.env.METRICOOL_API_TOKEN
  if (!userId || !token) return res.status(500).json({ error: 'Metricool env vars not set' })

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, metricool_blog_id')
    .not('metricool_blog_id', 'is', null)

  if (clientsError) return res.status(500).json({ error: clientsError.message })

  const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T23:59:59'

  const results = []

  for (const client of clients) {
    const url = `https://app.metricool.com/api/v2/scheduler/posts?userId=${userId}&blogId=${client.metricool_blog_id}&start=${startDate}&end=${endDate}&timezone=America/New_York`

    let posts
    try {
      const response = await fetch(url, { headers: { 'X-Mc-Auth': token, 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(data))
      posts = data.data || []
    } catch (err) {
      console.error(`Calendar sync fetch failed for ${client.name}:`, err.message)
      results.push({ client: client.name, status: 'fetch_error', message: err.message })
      continue
    }

    // Existing rows for this client, keyed by metricool_id, to compare
    // against — metricool_id is stored as text in calendar_events, so we
    // key this map with String() to match reliably.
    const { data: existingRows } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('client_id', client.id)
      .not('metricool_id', 'is', null)
    const existingByMetricoolId = {}
    ;(existingRows || []).forEach(r => { existingByMetricoolId[String(r.metricool_id)] = r })

    let created = 0, updated = 0, unchanged = 0

    for (const post of posts) {
      const network = post.providers?.[0]?.network || null
      const computed = {
        client_id: client.id,
        metricool_id: String(post.id),
        date: post.publicationDate?.dateTime?.slice(0, 10) || null,
        title: post.text || null,
        type: 'social',
        notes: network,
        image_url: post.media?.[0] || null
      }
      // Diagnostic-only, for the preview log — never part of the real write
      // payload. Lets us check the raw Metricool timestamp directly from
      // Supabase if a date mismatch shows up, without needing a live
      // session to go re-fetch it.
      const diagnostics = {
        raw_dateTime: post.publicationDate?.dateTime || null,
        raw_timezone: post.publicationDate?.timezone || null
      }

      const existing = existingByMetricoolId[String(post.id)]
      let action = 'would_create'
      if (existing) {
        const matches =
          existing.date === computed.date &&
          existing.title === computed.title &&
          existing.notes === computed.notes &&
          existing.image_url === computed.image_url
        action = matches ? 'no_change' : 'would_update'
      }

      if (action === 'would_create') created++
      else if (action === 'would_update') updated++
      else unchanged++

      await supabase.from('calendar_sync_preview').upsert({
        client_id: client.id,
        metricool_id: String(post.id),
        action,
        computed_row: { ...computed, ...diagnostics },
        current_row: existing || null,
        checked_at: new Date().toISOString()
      }, { onConflict: 'client_id,metricool_id' })

      if (!DRY_RUN) {
        const { error: writeError } = await supabase.from('calendar_events').upsert(computed, { onConflict: 'client_id,metricool_id' })
        if (writeError) {
          console.error(`Write failed for ${client.name} / post ${post.id}:`, writeError.message)
        }
      }
    }

    results.push({ client: client.name, postsChecked: posts.length, wouldCreate: created, wouldUpdate: updated, unchanged, status: 'ok' })
  }

  return res.status(200).json({ dryRun: DRY_RUN, ranAt: new Date().toISOString(), results })
}
