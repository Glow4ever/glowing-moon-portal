// api/team-reminders.js
//
// Daily cron, but it only emails on two days:
// - Monday: "This week" digest, one email per client owner, listing only
//   that owner's clients (review cycle to send, which report goes out,
//   quarterly call to book).
// - Thursday: one follow-up per owner, only if a review cycle due this week
//   still hasn't been sent. No follow-up at all if everything's sent.
//
// Each email goes to the client's owner (clients.account_manager_id) with
// every admin copied. A client with no owner goes to the admin alone.
//
// Clients with no Delivery week 1 yet are listed on Monday as onboarding so
// the delivery clock is never forgotten. They get no other reminders.
//
// Nothing here needs ticking off. A review counts as sent the moment a
// review cycle is created for that client during the week. A quarterly
// call clears when someone clicks "Mark booked".
//
// The items come from _weekitems.js, the same source the This Week page
// reads, so the email and the page always say the same thing.
//
// For testing, ?mode=monday or ?mode=thursday forces that email today
// (still requires the cron secret).

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')
const { addDays, todayUTC, shortDate } = require('./_cadence')
const { buildWeek } = require('./_weekitems')
const { loadTeam, routingFor } = require('./_team')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)

function fmt(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// One group per owner: { routing, rows, onboarding }
function groupByOwner(week, team) {
  const groups = new Map()
  function groupFor(client) {
    const routing = routingFor(team, client.account_manager_id)
    const key = routing.to.join(',')
    if (!groups.has(key)) groups.set(key, { routing, rows: [], onboarding: [] })
    return groups.get(key)
  }
  for (const r of week.rows) groupFor(r.client).rows.push(r)
  for (const o of week.onboarding) groupFor(o.client).onboarding.push(o)
  return [...groups.values()]
}

function shell(title, intro, bodyRows) {
  return `
    <!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;"><tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border-radius:12px;overflow:hidden;border-top:2px solid #D3C9A7;">
          <tr><td style="padding:40px;">
            <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;margin-bottom:24px;">Glowing Moon Media</div>
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#ffffff;">${title}</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#888;line-height:1.6;">${intro}</p>
            ${bodyRows}
            <a href="https://portal.glowingmoonmedia.com/this-week" style="display:inline-block;margin-top:24px;background:#D3C9A7;color:#111;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">Open This Week</a>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`
}

function clientBlock(name, weekLabel, items) {
  const lines = items.map(i => {
    const mark = i.done ? '&#10003;' : '&#9675;'
    const color = i.done ? '#5DCAA5' : '#ffffff'
    const suffix = i.done ? ' <span style="color:#555;">(sent)</span>' : ''
    return `<div style="font-size:14px;color:${color};line-height:1.8;">${mark}&nbsp; ${i.text}${suffix}</div>`
  }).join('')
  return `<div style="padding:14px 0;border-bottom:1px solid #222;">
    <div style="font-size:15px;color:#fff;font-weight:600;margin-bottom:4px;">${name} <span style="font-weight:400;color:#666;font-size:12px;">${weekLabel}</span></div>
    ${lines}
  </div>`
}

function ownerNote(routing) {
  return routing.isOwnerEditor ? ` Managed by ${routing.ownerEmail}.` : ''
}

async function send(routing, subject, html) {
  const payload = {
    from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
    to: routing.to,
    subject,
    html,
  }
  if (routing.cc.length) payload.cc = routing.cc
  await resend.emails.send(payload)
}

async function sendMonday(group, today) {
  const { rows, onboarding, routing } = group
  const withItems = rows.filter(r => r.items.length > 0)
  if (withItems.length === 0 && onboarding.length === 0) return { sent: false, reason: 'nothing due' }
  const body = withItems.map(r => clientBlock(r.client.name, `week ${r.cad.weekInCycle} of 4`, r.items)).join('')
  const quiet = rows.filter(r => r.items.length === 0).map(r => r.client.name)
  const quietLine = quiet.length ? `<p style="margin:16px 0 0;font-size:13px;color:#666;">Nothing due: ${quiet.join(', ')}</p>` : ''
  const onboardingLine = onboarding.length
    ? `<p style="margin:16px 0 0;font-size:13px;color:#D3C9A7;">Onboarding: ${onboarding.map(o => o.plan.status === 'upcoming' ? `${o.client.name} (delivery starts ${shortDate(o.plan.startsOn)})` : `${o.client.name} (delivery week 1 not set)`).join(', ')}</p>`
    : ''
  await send(
    routing,
    `This week: ${fmt(today)} to ${fmt(addDays(today, 6))}`,
    shell('This week', `What's due per client for the week of ${fmt(today)}.${ownerNote(routing)}`, body + quietLine + onboardingLine)
  )
  return { sent: true, to: routing.to, clients: withItems.length, onboarding: onboarding.length }
}

async function sendThursday(group) {
  const { rows, routing } = group
  const unsent = rows
    .map(r => ({ ...r, items: r.items.filter(i => i.kind === 'review' && !i.done) }))
    .filter(r => r.items.length > 0)
  if (unsent.length === 0) return { sent: false, reason: 'all reviews sent' }
  const body = unsent.map(r => clientBlock(r.client.name, '', r.items)).join('')
  await send(
    routing,
    unsent.length === 1 ? `Review cycle still to send: ${unsent[0].client.name}` : `${unsent.length} review cycles still to send`,
    shell('Review cycles still to send', `These are due this week and haven't gone out yet.${ownerNote(routing)}`, body)
  )
  return { sent: true, to: routing.to, clients: unsent.length }
}

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const today = todayUTC()
  const forced = req.query?.mode
  const dow = today.getUTCDay()
  const mode = forced || (dow === 1 ? 'monday' : dow === 4 ? 'thursday' : null)
  if (!mode) return res.status(200).json({ skipped: 'not a reminder day' })

  try {
    const [week, team] = await Promise.all([buildWeek(supabase, today), loadTeam(supabase)])
    const groups = groupByOwner(week, team)
    const results = []
    for (const group of groups) {
      try {
        results.push(mode === 'monday' ? await sendMonday(group, today) : await sendThursday(group))
      } catch (err) {
        // One owner's failed email must not stop the others.
        console.error('team-reminders send failed for', group.routing.to, err)
        results.push({ sent: false, to: group.routing.to, error: err.message })
      }
    }
    return res.status(200).json({ mode, results })
  } catch (err) {
    console.error('team-reminders error:', err)
    return res.status(500).json({ error: err.message })
  }
}
