// api/client-reports.js
//
// Two independent clocks, on purpose:
// - Mid-month note: every 14 days from each client's own retainer_start_date.
//   Reassurance during the window after direct contact drops off — that's
//   about time-since-onboarding, not calendar position.
// - Month-in-review: calendar months, triggered on the 1st. This is where
//   metrics/growth/ROI live, and those genuinely should read as "here's
//   August" like every other dashboard and the ROI docs themselves do.
//
// This function only ever ASSEMBLES a draft and notifies admin. Nothing
// sends automatically — Admin reviews, edits if needed, then explicitly
// sends or cancels from the Admin Panel.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date()
  const todayStr = isoDate(today)

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, retainer_start_date, time_recovered_hours, time_recovered_value, cost_avoidance_amount, cost_avoidance_label')
    .not('retainer_start_date', 'is', null)

  if (clientsError) return res.status(500).json({ error: clientsError.message })

  const results = []

  for (const client of clients) {
    const startDate = new Date(client.retainer_start_date + 'T00:00:00')

    // ---------- MID-MONTH NOTE (every 14 days, client's own clock) ----------
    const daysSince = Math.floor((today - startDate) / (1000 * 60 * 60 * 24))
    if (daysSince > 0 && daysSince % 14 === 0) {
      const periodStart = isoDate(new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000))
      const periodEnd = todayStr

      const { data: existing } = await supabase
        .from('client_report_drafts')
        .select('id')
        .eq('client_id', client.id).eq('report_type', 'mid_month')
        .eq('period_start', periodStart).eq('period_end', periodEnd)
        .maybeSingle()

      if (!existing) {
        // Real posts published in the window — dedupe by metricool_id since
        // cross-posted content has one row per platform, not one per post.
        const { data: postRows } = await supabase
          .from('calendar_events')
          .select('date, title, metricool_id')
          .eq('client_id', client.id)
          .gte('date', periodStart).lte('date', periodEnd)
          .not('metricool_id', 'is', null)
        const uniquePosts = Object.values(
          (postRows || []).reduce((acc, r) => { acc[r.metricool_id] = r; return acc }, {})
        )

        const { data: cycles } = await supabase
          .from('review_cycles')
          .select('folder_label, resolved_at')
          .eq('client_id', client.id)
          .gte('resolved_at', periodStart).lte('resolved_at', periodEnd)

        let draft = `Here's what we handled for you between ${periodStart} and ${periodEnd}:\n\n`
        draft += `- ${uniquePosts.length} piece${uniquePosts.length === 1 ? '' : 's'} of content published\n`
        if (cycles && cycles.length > 0) {
          draft += `- ${cycles.length} review cycle${cycles.length === 1 ? '' : 's'} completed (${cycles.map(c => c.folder_label).join(', ')})\n`
        }
        if (uniquePosts.length > 0) {
          draft += `\nWhat went out:\n` + uniquePosts.slice(0, 10).map(p => `- ${p.date}: ${p.title || '(untitled)'}`).join('\n')
        }

        await supabase.from('client_report_drafts').insert({
          client_id: client.id,
          report_type: 'mid_month',
          period_start: periodStart,
          period_end: periodEnd,
          draft_content: draft
        })
        await supabase.from('notifications').insert({
          client_id: client.id,
          type: 'report_ready',
          message: `Time for ${client.name}'s mid-month note — draft ready for review.`,
          read: false
        })
        results.push({ client: client.name, type: 'mid_month', status: 'created' })
      }
    }

    // ---------- MONTH-IN-REVIEW (calendar month, triggered on the 1st) ----------
    if (today.getDate() === 1) {
      const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
      const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)

      if (startDate > prevMonthEnd) {
        // Client hasn't started yet relative to this period at all — skip.
        continue
      }

      let effectiveStart = isoDate(prevMonthStart)
      let isPartial = false
      if (startDate >= prevMonthStart && startDate <= prevMonthEnd) {
        // Started partway through last month — only worth a partial review
        // if there's a real stretch to report on. Onboarding in the back
        // half of a month means the first real review is just next month.
        if (startDate.getDate() > 20) continue
        effectiveStart = isoDate(startDate)
        isPartial = true
      }
      const periodEnd = isoDate(prevMonthEnd)

      const { data: existing } = await supabase
        .from('client_report_drafts')
        .select('id')
        .eq('client_id', client.id).eq('report_type', 'month_in_review')
        .eq('period_start', effectiveStart).eq('period_end', periodEnd)
        .maybeSingle()

      if (!existing) {
        const { data: snapRows } = await supabase
          .from('metric_snapshots')
          .select('platform, value, recorded_date')
          .eq('client_id', client.id).eq('metric_type', 'audience')
          .gte('recorded_date', effectiveStart).lte('recorded_date', periodEnd)
          .order('recorded_date', { ascending: true })

        const byPlatform = {}
        ;(snapRows || []).forEach(r => {
          if (!byPlatform[r.platform]) byPlatform[r.platform] = []
          byPlatform[r.platform].push(Number(r.value))
        })
        const growthLines = Object.entries(byPlatform)
          .filter(([, values]) => values.length > 1)
          .map(([platform, values]) => {
            const delta = values[values.length - 1] - values[0]
            return `${platform}: ${delta >= 0 ? '+' : ''}${Math.round(delta)}`
          })

        const { data: logEntries } = await supabase
          .from('client_log_entries')
          .select('title, note, entry_type')
          .eq('client_id', client.id)
          .gte('entry_date', effectiveStart).lte('entry_date', periodEnd)
          .in('entry_type', ['press_mention', 'qualitative_win'])

        let draft = `Month in Review${isPartial ? ' — first partial period' : ''}: ${effectiveStart} to ${periodEnd}\n\n`
        if (client.time_recovered_hours) {
          draft += `Time recovered: ~${client.time_recovered_hours} hrs/mo`
          if (client.time_recovered_value) draft += ` (≈ $${(client.time_recovered_hours * client.time_recovered_value).toLocaleString()}/mo value)`
          draft += `\n`
        }
        if (client.cost_avoidance_amount) {
          draft += `Cost avoidance: $${Number(client.cost_avoidance_amount).toLocaleString()}/mo vs. ${client.cost_avoidance_label || 'the alternative'}\n`
        }
        draft += `\nAudience growth:\n${growthLines.length > 0 ? growthLines.join('\n') : 'Still building history — check back next month.'}\n`
        if (logEntries && logEntries.length > 0) {
          draft += `\nHighlights this period:\n` + logEntries.map(e => `- ${e.title || e.note}`).join('\n')
        }

        await supabase.from('client_report_drafts').insert({
          client_id: client.id,
          report_type: 'month_in_review',
          period_start: effectiveStart,
          period_end: periodEnd,
          draft_content: draft
        })
        await supabase.from('notifications').insert({
          client_id: client.id,
          type: 'report_ready',
          message: `Time for ${client.name}'s month-in-review — draft ready for review.`,
          read: false
        })
        results.push({ client: client.name, type: 'month_in_review', status: 'created' })
      }
    }
  }

  return res.status(200).json({ ranAt: new Date().toISOString(), results })
}
