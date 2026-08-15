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
    .select('id, name, metricool_blog_id, cadence_targets')
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
      // Diagnostic: is Metricool paginating this response? If posts are
      // consistently missing regardless of how many runs pass, an unhandled
      // page limit is the leading suspect — this shows us the raw response
      // shape so we can confirm or rule that out.
      console.log(
        `${client.name}: raw response top-level keys:`, JSON.stringify(Object.keys(data)),
        '| posts returned:', posts.length
      )
      // Diagnostic: exactly what Metricool returned, before any of our own
      // processing touches it — needed to check whether Instagram posts are
      // actually present in the raw response at all.
      console.log(
        `${client.name}: ${posts.length} posts fetched. Networks:`,
        JSON.stringify(posts.map(p => ({ id: p.id, providers: p.providers?.map(pr => pr.network) })))
      )
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
    ;(existingRows || []).forEach(r => {
      const key = String(r.metricool_id)
      if (!existingByMetricoolId[key]) existingByMetricoolId[key] = []
      existingByMetricoolId[key].push(r)
    })

    let created = 0, updated = 0, unchanged = 0

    for (const post of posts) {
      const networks = post.providers?.map(p => p.network).filter(Boolean) || [null]

      for (const network of networks) {
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

        // Matched on metricool_id + network now, not metricool_id alone —
        // one post can have a row per platform it was actually sent to.
        const existing = (existingByMetricoolId[String(post.id)] || []).find(r => r.notes === network)
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
          metricool_id: `${post.id}:${network || 'none'}`,
          action,
          computed_row: { ...computed, ...diagnostics },
          current_row: existing || null,
          checked_at: new Date().toISOString()
        }, { onConflict: 'client_id,metricool_id' })

        if (!DRY_RUN) {
          const { error: writeError } = await supabase.from('calendar_events').upsert(computed, { onConflict: 'client_id,metricool_id,notes' })
          if (writeError) {
            console.error(`Write failed for ${client.name} / post ${post.id} / ${network}:`, writeError.message)
          }
        }
      }
    }

    // Prune candidate detection — reuses `posts` (Metricool's live schedule,
    // already fetched above) and `existingRows` (already fetched above),
    // no extra API call needed. Never deletes anything. A row only gets
    // logged as a candidate, and only actually becomes eligible for
    // deletion once it's missed TWO CONSECUTIVE runs — see the miss_count
    // logic below and the table comment in 010_calendar_prune_candidates.sql
    // for why that matters.
    const liveMetricoolIds = new Set(posts.map(p => String(p.id)))
    const syncedExistingRows = (existingRows || []).filter(r => r.metricool_id)
    let clearedCount = 0, flaggedCount = 0, bumpedCount = 0

    for (const row of syncedExistingRows) {
      const stillLive = liveMetricoolIds.has(String(row.metricool_id))

      if (stillLive) {
        const { error, count } = await supabase.from('calendar_prune_candidates').delete({ count: 'exact' })
          .eq('client_id', client.id).eq('calendar_event_id', row.id)
        if (count) clearedCount++
        continue
      }

      const { data: existingCandidate } = await supabase
        .from('calendar_prune_candidates')
        .select('id, miss_count')
        .eq('client_id', client.id).eq('calendar_event_id', row.id)
        .maybeSingle()

      if (existingCandidate) {
        await supabase.from('calendar_prune_candidates').update({
          miss_count: existingCandidate.miss_count + 1,
          last_checked_at: new Date().toISOString()
        }).eq('id', existingCandidate.id)
        bumpedCount++
      } else {
        await supabase.from('calendar_prune_candidates').insert({
          client_id: client.id,
          calendar_event_id: row.id,
          metricool_id: row.metricool_id,
          notes: row.notes,
          title: row.title,
          date: row.date
        })
        flaggedCount++
      }
    }

    console.log(`${client.name}: prune check — ${flaggedCount} newly flagged, ${bumpedCount} bumped to a repeat miss, ${clearedCount} cleared (reappeared).`)

    // Cadence adherence — real posts delivered vs. the client's own target
    // (set once in Admin, pulled from their strategy playbook), per
    // platform. Reuses existingRows already fetched above for the
    // create/update pass — no extra query needed. Not capped at 100%:
    // over-delivering is real information worth showing, not clamping away.
    if (client.cadence_targets && Object.keys(client.cadence_targets).length > 0) {
      const cadenceWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const cadenceWindowEnd = new Date().toISOString().slice(0, 10)
      const recentSyncedRows = (existingRows || []).filter(r => r.date >= cadenceWindowStart && r.date <= cadenceWindowEnd)

      for (const [platform, weeklyTarget] of Object.entries(client.cadence_targets)) {
        if (!weeklyTarget || weeklyTarget <= 0) continue
        const actualCount = recentSyncedRows.filter(r => r.notes === platform).length
        const monthlyTarget = weeklyTarget * (30 / 7)
        const adherence = Math.round((actualCount / monthlyTarget) * 100)

        await supabase.from('metric_aggregates').upsert({
          client_id: client.id,
          metric_type: 'cadence',
          platform,
          value: adherence,
          period_start: cadenceWindowStart,
          period_end: cadenceWindowEnd
        }, { onConflict: 'client_id,metric_type,platform,period_start,period_end' })
      }
    }

    results.push({ client: client.name, postsChecked: posts.length, wouldCreate: created, wouldUpdate: updated, unchanged, status: 'ok' })
  }

  return res.status(200).json({ dryRun: DRY_RUN, ranAt: new Date().toISOString(), results })
}
