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
    .select('id, name, retainer_start_date, time_recovered_hours, time_recovered_value, cost_avoidance_amount, cost_avoidance_label, roi_show_time_hours, roi_show_time_value, roi_show_cost_avoidance')
    .not('retainer_start_date', 'is', null)

  if (clientsError) return res.status(500).json({ error: clientsError.message })

  const results = []

  for (const client of clients) {
    const startDate = new Date(client.retainer_start_date + 'T00:00:00')

    // ---------- MID-MONTH NOTE (at least 14 days since the last one, client's own clock) ----------
    // Deliberately NOT an exact "daysSince % 14 === 0" check — that's
    // fragile to a single missed cron run (a deploy hiccup, anything) and
    // would then silently wait until the next exact 14-day mark instead of
    // catching up. Checking "has it been >= 14 days since the last note"
    // is self-healing: if a run gets missed, the next run just catches it.
    const { data: lastMidMonth } = await supabase
      .from('client_report_drafts')
      .select('period_end')
      .eq('client_id', client.id).eq('report_type', 'mid_month')
      .eq('status', 'sent')
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastMidMonthDate = lastMidMonth ? new Date(lastMidMonth.period_end + 'T00:00:00') : startDate
    const daysSinceLastNote = Math.floor((today - lastMidMonthDate) / (1000 * 60 * 60 * 24))
    const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24))

    if (daysSinceStart > 0 && daysSinceLastNote >= 14) {
      const periodStart = isoDate(lastMidMonthDate)
      const periodEnd = todayStr

      const { data: existing } = await supabase
        .from('client_report_drafts')
        .select('id, status')
        .eq('client_id', client.id).eq('report_type', 'mid_month')
        .eq('period_start', periodStart).eq('period_end', periodEnd)
        .maybeSingle()

      // A cancelled draft for this exact window shouldn't block a fresh
      // attempt — only an already-pending or already-sent one should.
      if (!existing || existing.status === 'cancelled') {
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

        // Opener varies with what actually happened — a quiet period reads
        // as "steady and consistent," not as an apology for low volume.
        let draft = uniquePosts.length > 0
          ? `Another two weeks in the books! Here's a quick look at what's been moving on your channels.\n\n`
          : `Checking in for your two-week update — a quieter stretch behind the scenes as we kept things steady.\n\n`

        draft += `${uniquePosts.length} piece${uniquePosts.length === 1 ? '' : 's'} of content went out`
        if (cycles && cycles.length > 0) {
          draft += `, and you turned around ${cycles.length === 1 ? 'a' : cycles.length} review${cycles.length === 1 ? '' : 's'} for us along the way (${cycles.map(c => c.folder_label).join(', ')}) — thanks for the quick turnaround.`
        } else {
          draft += `.`
        }
        draft += `\n`

        if (uniquePosts.length > 0) {
          draft += `\nWhat went out:\n` + uniquePosts.slice(0, 10).map(p => `- ${p.date}: ${p.title || '(untitled)'}`).join('\n') + '\n'
        }

        draft += `\nAs always, reach out anytime if something's on your mind. Otherwise, see you at the next check-in!`

        await supabase.from('client_report_drafts').upsert({
          client_id: client.id,
          report_type: 'mid_month',
          period_start: periodStart,
          period_end: periodEnd,
          draft_content: draft,
          status: 'pending',
          sent_at: null
        }, { onConflict: 'client_id,report_type,period_start,period_end' })
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
        .select('id, status')
        .eq('client_id', client.id).eq('report_type', 'month_in_review')
        .eq('period_start', effectiveStart).eq('period_end', periodEnd)
        .maybeSingle()

      if (!existing || existing.status === 'cancelled') {
        const { data: snapRows } = await supabase
          .from('metric_snapshots')
          .select('platform, metric_type, value, recorded_date')
          .eq('client_id', client.id).in('metric_type', ['audience', 'engagement'])
          .gte('recorded_date', effectiveStart).lte('recorded_date', periodEnd)
          .order('recorded_date', { ascending: true })

        const audienceByPlatform = {}
        const engagementByPlatform = {}
        ;(snapRows || []).forEach(r => {
          const bucket = r.metric_type === 'audience' ? audienceByPlatform : engagementByPlatform
          if (!bucket[r.platform]) bucket[r.platform] = []
          bucket[r.platform].push(Number(r.value))
        })

        // Real per-platform figures — start, end, absolute change, and
        // percent growth — not just a bare delta.
        const platformStats = Object.entries(audienceByPlatform)
          .filter(([, values]) => values.length > 1)
          .map(([platform, values]) => {
            const start = values[0]
            const end = values[values.length - 1]
            const delta = end - start
            const pct = start > 0 ? Math.round((delta / start) * 100) : null
            return { platform, start, end, delta, pct }
          })
        const totalAudienceNow = Object.values(audienceByPlatform)
          .reduce((sum, values) => sum + values[values.length - 1], 0)
        const standout = platformStats.filter(p => p.delta > 0).sort((a, b) => b.delta - a.delta)[0]

        const avgEngagementByPlatform = Object.entries(engagementByPlatform)
          .map(([platform, values]) => ({ platform, avg: values.reduce((s, v) => s + v, 0) / values.length }))

        const { data: logEntries } = await supabase
          .from('client_log_entries')
          .select('title, note, entry_type')
          .eq('client_id', client.id)
          .gte('entry_date', effectiveStart).lte('entry_date', periodEnd)
          .in('entry_type', ['press_mention', 'qualitative_win'])

        let draft = isPartial
          ? `Your first few weeks are in the books! Here's where things stand as we get rolling.\n\n`
          : `Here's your month in review — a look back at what the last few weeks added up to.\n\n`

        // ROI baselines — only ever mentioned if explicitly marked visible
        // for this specific client. A number existing in the system is not
        // enough on its own; each client has its own real sensitivities
        // (comparing cost-avoidance to an existing team member, attaching
        // a dollar figure to a CEO's personal time) that this is deliberately
        // built to respect rather than assume.
        const roiLines = []
        if (client.time_recovered_hours && client.roi_show_time_hours) {
          let line = `you're getting back roughly ${client.time_recovered_hours} hours a month`
          if (client.time_recovered_value && client.roi_show_time_value) {
            line += ` (≈ $${(client.time_recovered_hours * client.time_recovered_value).toLocaleString()} at your stated rate)`
          }
          roiLines.push(line)
        }
        if (client.cost_avoidance_amount && client.roi_show_cost_avoidance) {
          roiLines.push(`this replaces roughly $${Number(client.cost_avoidance_amount).toLocaleString()}/mo you'd otherwise be spending on ${client.cost_avoidance_label || 'the alternative'}`)
        }
        if (roiLines.length > 0) {
          const joinedRoi = roiLines.length === 2 ? roiLines.join(' and ') : roiLines[0]
          draft += `First, the sure thing: ${joinedRoi} — true regardless of anything else this month.\n\n`
        }

        if (platformStats.length > 0) {
          draft += `Here's how things moved this period. `
          if (totalAudienceNow > 0) draft += `You're sitting at ${totalAudienceNow.toLocaleString()} total followers across every connected platform. `
          if (standout) {
            draft += `${standout.platform.charAt(0).toUpperCase() + standout.platform.slice(1)} led the way this period — ${standout.start.toLocaleString()} to ${standout.end.toLocaleString()}, up ${standout.delta >= 0 ? '+' : ''}${Math.round(standout.delta)}${standout.pct !== null ? ` (${standout.pct >= 0 ? '+' : ''}${standout.pct}%)` : ''}. `
          }
          const others = platformStats.filter(p => p !== standout)
          if (others.length > 0) {
            draft += `Elsewhere: ` + others.map(p => `${p.platform} ${p.delta >= 0 ? '+' : ''}${Math.round(p.delta)}${p.pct !== null ? ` (${p.pct >= 0 ? '+' : ''}${p.pct}%)` : ''}`).join(', ') + '. '
          }
          if (avgEngagementByPlatform.length > 0) {
            draft += `\n\nEngagement this period: ` + avgEngagementByPlatform.map(e => `${e.platform} averaging ${e.avg.toFixed(1)}%`).join(', ') + '.'
          }
          draft += '\n'
        } else {
          draft += `Performance breakdown: still early days on the trend lines — check back next month as more history builds in.\n`
        }

        if (logEntries && logEntries.length > 0) {
          draft += `\nA couple of things worth celebrating from this stretch:\n` + logEntries.map(e => `- ${e.title || e.note}`).join('\n') + '\n'
        }

        draft += `\nEach month is a chance to reflect on what we've built together — a growing presence that brings real credibility. Thank you for trusting us with this. We look forward to seeing where next month leads. Reach out anytime if you want to talk through any of it.`

        await supabase.from('client_report_drafts').upsert({
          client_id: client.id,
          report_type: 'month_in_review',
          period_start: effectiveStart,
          period_end: periodEnd,
          draft_content: draft,
          status: 'pending',
          sent_at: null
        }, { onConflict: 'client_id,report_type,period_start,period_end' })
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
