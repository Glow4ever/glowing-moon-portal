// api/client-reports.js
//
// Daily cron. Only ever ASSEMBLES drafts and emails the client's owner
// (admin copied) that they're ready. Nothing goes to a client until a
// person reviews and clicks Send on the Reports page.
//
// Schedules follow each client's weekly rhythm (see _cadence.js weekPlan),
// which alternates so a client hears from GMM once a week:
//   Week 1 review cycle, week 2 two-week note, week 3 review cycle,
//   week 4 monthly report.
// Clients with no Delivery week 1 are onboarding and get nothing.
// Drafts are created at the start of the week they go out, covering
// everything since the previous report. Window boundaries never move,
// so each draft is created once whether it's sent, cancelled or ignored.
//
// Operations clients (primary_frame = 'operations') skip the two-week
// note and get a monthly recap built around a summary admin writes.

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')
const { parseDate, iso, addDays, todayUTC, weekPlan } = require('./_cadence')
const { loadTeam, routingFor } = require('./_team')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)

const SUMMARY_PLACEHOLDER = '[YOUR SUMMARY: 2-4 sentences on what we accomplished together these past four weeks.]'

function fmt(s) {
  return parseDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// A draft already exists for this window, OR the same report type was
// drafted for this client in the last 10 days. The second check means
// changing a client's Delivery week 1 mid-week can never produce a
// duplicate, because the windows move but the recent draft is still found.
async function draftExists(clientId, reportType, periodStart, periodEnd) {
  const { data } = await supabase
    .from('client_report_drafts')
    .select('id')
    .eq('client_id', clientId).eq('report_type', reportType)
    .eq('period_start', periodStart).eq('period_end', periodEnd)
    .maybeSingle()
  if (data) return true
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('client_report_drafts')
    .select('id')
    .eq('client_id', clientId).eq('report_type', reportType)
    .gte('created_at', since)
    .limit(1)
  return !!(recent && recent.length)
}

function roiLinesFor(client) {
  const lines = []
  if (client.time_recovered_hours && client.roi_show_time_hours) {
    let line = `you're getting back roughly ${client.time_recovered_hours} hours a month`
    if (client.time_recovered_value && client.roi_show_time_value) {
      line += ` (about $${(client.time_recovered_hours * client.time_recovered_value).toLocaleString()} at your stated rate)`
    }
    lines.push(line)
  }
  if (client.cost_avoidance_amount && client.roi_show_cost_avoidance) {
    lines.push(`this replaces roughly $${Number(client.cost_avoidance_amount).toLocaleString()}/mo you'd otherwise be spending on ${client.cost_avoidance_label || 'the alternative'}`)
  }
  return lines
}

async function buildTwoWeekNote(client, windowStart, windowEnd, dueDate) {
  const { data: postRows } = await supabase
    .from('calendar_events')
    .select('date, title, metricool_id')
    .eq('client_id', client.id)
    .gte('date', windowStart).lte('date', windowEnd)
    .not('metricool_id', 'is', null)
  // Cross-posted content has one row per platform; dedupe to one per post.
  const uniquePosts = Object.values(
    (postRows || []).reduce((acc, r) => { acc[r.metricool_id] = r; return acc }, {})
  )

  const { data: cycles } = await supabase
    .from('review_cycles')
    .select('folder_label, resolved_at')
    .eq('client_id', client.id)
    .gte('resolved_at', windowStart).lt('resolved_at', dueDate)

  let draft = uniquePosts.length > 0
    ? `Another two weeks in the books! Here's a quick look at what's been moving on your channels.\n\n`
    : `Checking in for your two-week update. A quieter stretch behind the scenes as we kept things steady.\n\n`

  draft += `${uniquePosts.length} piece${uniquePosts.length === 1 ? '' : 's'} of content went out`
  if (cycles && cycles.length > 0) {
    draft += `, and you turned around ${cycles.length === 1 ? 'a' : cycles.length} review${cycles.length === 1 ? '' : 's'} for us along the way (${cycles.map(c => c.folder_label).join(', ')}). Thanks for the quick turnaround.`
  } else {
    draft += `.`
  }
  draft += `\n`

  if (uniquePosts.length > 0) {
    draft += `\nWhat went out:\n` + uniquePosts.slice(0, 10).map(p => `- ${p.date}: ${p.title || '(untitled)'}`).join('\n') + '\n'
  }

  draft += `\nAs always, reach out anytime if something's on your mind. Otherwise, see you at the next check-in!`
  return draft
}

async function buildCredibilityMonthly(client, periodStart, periodEnd, isPartial) {
  const { data: snapRows } = await supabase
    .from('metric_snapshots')
    .select('platform, metric_type, value, recorded_date')
    .eq('client_id', client.id).in('metric_type', ['audience', 'engagement'])
    .gte('recorded_date', periodStart).lte('recorded_date', periodEnd)
    .order('recorded_date', { ascending: true })

  const audienceByPlatform = {}
  const engagementByPlatform = {}
  ;(snapRows || []).forEach(r => {
    const bucket = r.metric_type === 'audience' ? audienceByPlatform : engagementByPlatform
    if (!bucket[r.platform]) bucket[r.platform] = []
    bucket[r.platform].push(Number(r.value))
  })

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
    .gte('entry_date', periodStart).lte('entry_date', periodEnd)
    .in('entry_type', ['press_mention', 'qualitative_win'])

  let draft = isPartial
    ? `Your first few weeks are in the books! Here's where things stand as we get rolling.\n\n`
    : `Here's your month in review, a look back at what the last few weeks added up to.\n\n`

  const roiLines = roiLinesFor(client)
  if (roiLines.length > 0) {
    draft += `First, the sure thing: ${roiLines.join(' and ')}, true regardless of anything else this month.\n\n`
  }

  if (platformStats.length > 0) {
    draft += `Here's how things moved this period. `
    if (totalAudienceNow > 0) draft += `You're sitting at ${totalAudienceNow.toLocaleString()} total followers across every connected platform. `
    if (standout) {
      const name = standout.platform.charAt(0).toUpperCase() + standout.platform.slice(1)
      draft += `${name} led the way: ${standout.start.toLocaleString()} to ${standout.end.toLocaleString()}, up +${Math.round(standout.delta)}${standout.pct !== null ? ` (+${standout.pct}%)` : ''}. `
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
    draft += `Performance breakdown: still early days on the trend lines. Check back next month as more history builds in.\n`
  }

  if (logEntries && logEntries.length > 0) {
    draft += `\nA couple of things worth celebrating from this stretch:\n` + logEntries.map(e => `- ${e.title || e.note}`).join('\n') + '\n'
  }

  draft += `\nEach month is a chance to reflect on what we've built together: a growing presence that brings real credibility. Thank you for trusting us with this. Reach out anytime if you want to talk through any of it.`
  return draft
}

// Operations clients: GMM supports their team's content work rather than
// publishing for them, so platform stats aren't ours to report. The draft
// leads with a summary admin writes, backed by a few delivery facts the
// portal already knows. Admin.jsx blocks sending while the placeholder
// is still in the text.
async function buildOperationsMonthly(client, periodStart, periodEnd) {
  const nextDay = iso(addDays(parseDate(periodEnd), 1))

  const { data: cycles } = await supabase
    .from('review_cycles')
    .select('folder_label')
    .eq('client_id', client.id)
    .gte('resolved_at', periodStart).lt('resolved_at', nextDay)

  const { count: approvedCount } = await supabase
    .from('file_status')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id).eq('status', 'approved')
    .gte('updated_at', periodStart).lt('updated_at', nextDay)

  const { data: logEntries } = await supabase
    .from('client_log_entries')
    .select('title, note')
    .eq('client_id', client.id)
    .gte('entry_date', periodStart).lte('entry_date', periodEnd)
    .eq('entry_type', 'qualitative_win')

  let draft = `Here's your recap for ${fmt(periodStart)} to ${fmt(periodEnd)}.\n\n${SUMMARY_PLACEHOLDER}\n`

  const facts = []
  if (approvedCount) facts.push(`${approvedCount} piece${approvedCount === 1 ? '' : 's'} delivered and approved`)
  if (cycles && cycles.length > 0) facts.push(`${cycles.length} review round${cycles.length === 1 ? '' : 's'} completed (${cycles.map(c => c.folder_label).join(', ')})`)
  if (facts.length > 0) draft += `\nBy the numbers:\n` + facts.map(f => `- ${f}`).join('\n') + '\n'

  const roiLines = roiLinesFor(client)
  if (roiLines.length > 0) draft += `\nFor your team: ${roiLines.join(' and ')}.\n`

  if (logEntries && logEntries.length > 0) {
    draft += `\nHighlights:\n` + logEntries.map(e => `- ${e.title || e.note}`).join('\n') + '\n'
  }

  draft += `\nThanks for having us on the team. Reach out anytime if there's anything you'd like us to take on next month.`
  return draft
}

async function saveDraft(client, reportType, periodStart, periodEnd, draft, label, created) {
  const { error } = await supabase.from('client_report_drafts').insert({
    client_id: client.id,
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    draft_content: draft,
    status: 'pending'
  })
  // A unique-constraint conflict means another run already made it. Fine.
  if (error) return
  await supabase.from('notifications').insert({
    client_id: client.id,
    type: 'report_ready',
    message: `${client.name}'s ${label} is ready for review.`,
    read: false
  })
  created.push({ client: client.name, ownerId: client.account_manager_id || null, label, periodStart, periodEnd })
}

function reportsEmailHtml(created) {
  const rows = created.map(c =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #222;color:#fff;font-size:15px;">${c.client}</td>
     <td style="padding:10px 0;border-bottom:1px solid #222;color:#888;font-size:14px;text-align:right;">${c.label}<br><span style="font-size:12px;color:#555;">${c.periodStart} to ${c.periodEnd}</span></td></tr>`
  ).join('')
  return `
      <!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;"><tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border-radius:12px;overflow:hidden;border-top:2px solid #D3C9A7;">
            <tr><td style="padding:40px;">
              <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;margin-bottom:24px;">Glowing Moon Media</div>
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">Reports ready to review</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#888;line-height:1.6;">Nothing has been sent to clients. Review, edit, and send from the Reports page.</p>
              <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
              <a href="https://portal.glowingmoonmedia.com/reports" style="display:inline-block;margin-top:28px;background:#D3C9A7;color:#111;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">Open Reports</a>
            </td></tr>
          </table>
        </td></tr></table>
      </body></html>`
}

// One email per owner, listing only that owner's clients, admin copied.
async function emailOwners(created) {
  if (created.length === 0) return
  const team = await loadTeam(supabase)
  const groups = new Map()
  for (const c of created) {
    const routing = routingFor(team, c.ownerId)
    const key = routing.to.join(',')
    if (!groups.has(key)) groups.set(key, { routing, items: [] })
    groups.get(key).items.push(c)
  }
  for (const { routing, items } of groups.values()) {
    const payload = {
      from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
      to: routing.to,
      subject: items.length === 1
        ? `${items[0].client}: ${items[0].label} ready to review`
        : `${items.length} client reports ready to review`,
      html: reportsEmailHtml(items),
    }
    if (routing.cc.length) payload.cc = routing.cc
    await resend.emails.send(payload)
  }
}

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = todayUTC()

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, active, account_manager_id, primary_frame, retainer_start_date, delivery_start_date, time_recovered_hours, time_recovered_value, cost_avoidance_amount, cost_avoidance_label, roi_show_time_hours, roi_show_time_value, roi_show_cost_avoidance')

  if (clientsError) return res.status(500).json({ error: clientsError.message })

  const created = []

  for (const client of clients || []) {
    if (client.active === false) continue
    const plan = weekPlan(client, today)
    if (plan.status !== 'active') continue
    const cad = plan.cycle
    const isOperations = client.primary_frame === 'operations'

    // Each report covers everything since the previous one: the last week
    // of the prior cycle onward. The very first cycle starts at the
    // client's own start instead.
    const windowStart = cad.cycleIndex === 0 ? cad.start : addDays(cad.cycleStart, -7)
    const periodStart = iso(windowStart)

    // ---------- WEEK 2: TWO-WEEK NOTE (credibility clients) ----------
    if (plan.items.some(i => i.kind === 'note')) {
      const periodEnd = iso(addDays(cad.cycleStart, 6))
      if (!(await draftExists(client.id, 'mid_month', periodStart, periodEnd))) {
        const draft = await buildTwoWeekNote(client, periodStart, periodEnd, iso(cad.weekStart))
        await saveDraft(client, 'mid_month', periodStart, periodEnd, draft, 'two-week note', created)
      }
    }

    // ---------- WEEK 4: MONTHLY REPORT (all clients) ----------
    if (plan.items.some(i => i.kind === 'report')) {
      const periodEnd = iso(addDays(cad.cycleStart, 20))
      if (!(await draftExists(client.id, 'month_in_review', periodStart, periodEnd))) {
        const draft = isOperations
          ? await buildOperationsMonthly(client, periodStart, periodEnd)
          : await buildCredibilityMonthly(client, periodStart, periodEnd, cad.cycleIndex === 0)
        await saveDraft(client, 'month_in_review', periodStart, periodEnd, draft, isOperations ? 'monthly recap' : 'monthly report', created)
      }
    }
  }

  let emailError = null
  try { await emailOwners(created) } catch (err) { emailError = err.message; console.error('Report email failed:', err) }

  return res.status(200).json({ ranAt: new Date().toISOString(), created, emailError })
}
