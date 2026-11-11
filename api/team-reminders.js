// api/team-reminders.js
//
// Daily cron, but it only emails on two days:
// - Monday: "This week" digest for the team, listing per client what's due
//   (review cycle to send, which report goes out, quarterly call to book).
// - Thursday: one follow-up, only if a review cycle due this week still
//   hasn't been sent. No follow-up at all if everything's sent.
//
// Nothing here needs ticking off. A review counts as sent the moment a
// review cycle is created for that client during the week. A quarterly
// call clears when someone clicks "Mark booked" on the client card.
//
// For testing, ?mode=monday or ?mode=thursday forces that email today
// (still requires the cron secret).

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')
const { iso, addDays, todayUTC, cadenceFor, anchorFor, quarterlyCallDue } = require('./_cadence')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)

const RECIPIENTS = (process.env.TEAM_REMINDER_EMAILS || 'hector@glowingmoonmedia.com,ev@glowingmoonmedia.com')
  .split(',').map(s => s.trim()).filter(Boolean)

function fmt(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

async function buildClientItems(today) {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, name, active, primary_frame, retainer_start_date, report_schedule_start, quarterly_call_booked_at')
    .order('name')
  if (error) throw new Error(error.message)

  const out = []
  for (const client of clients || []) {
    if (client.active === false) continue
    const cad = cadenceFor(anchorFor(client), today)
    if (!cad) continue
    const isOps = client.primary_frame === 'operations'
    const items = []

    if (cad.weekInCycle === 1 || cad.weekInCycle === 3) {
      const { count } = await supabase
        .from('review_cycles')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('sent_at', iso(cad.weekStart))
        .lt('sent_at', iso(addDays(cad.weekEnd, 1)))
      items.push({ kind: 'review', done: (count || 0) > 0, text: 'Send review cycle' })
    }
    if (cad.weekInCycle === 2 && !isOps) {
      items.push({ kind: 'report', text: 'Two-week note goes out (draft arrives by email)' })
    }
    if (cad.weekInCycle === 4) {
      items.push({ kind: 'report', text: isOps ? 'Monthly recap goes out (write your summary first)' : 'Monthly report goes out (draft arrives by email)' })
    }
    if (quarterlyCallDue(cad, client.quarterly_call_booked_at)) {
      items.push({ kind: 'call', text: `Book quarterly call (quarter ends ${fmt(cad.quarterEnd)})` })
    }

    out.push({ client, cad, items })
  }
  return out
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
            <a href="https://portal.glowingmoonmedia.com/admin" style="display:inline-block;margin-top:24px;background:#D3C9A7;color:#111;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">Open Admin</a>
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

async function sendMonday(rows, today) {
  const withItems = rows.filter(r => r.items.length > 0)
  if (withItems.length === 0) return { sent: false, reason: 'nothing due' }
  const body = withItems.map(r => clientBlock(r.client.name, `week ${r.cad.weekInCycle} of 4`, r.items)).join('')
  const quiet = rows.filter(r => r.items.length === 0).map(r => r.client.name)
  const quietLine = quiet.length ? `<p style="margin:16px 0 0;font-size:13px;color:#666;">Nothing due: ${quiet.join(', ')}</p>` : ''
  await resend.emails.send({
    from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
    to: RECIPIENTS,
    subject: `This week: ${fmt(today)} to ${fmt(addDays(today, 6))}`,
    html: shell('This week', `What's due per client for the week of ${fmt(today)}.`, body + quietLine)
  })
  return { sent: true, clients: withItems.length }
}

async function sendThursday(rows) {
  const unsent = rows
    .map(r => ({ ...r, items: r.items.filter(i => i.kind === 'review' && !i.done) }))
    .filter(r => r.items.length > 0)
  if (unsent.length === 0) return { sent: false, reason: 'all reviews sent' }
  const body = unsent.map(r => clientBlock(r.client.name, '', r.items)).join('')
  await resend.emails.send({
    from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
    to: RECIPIENTS,
    subject: unsent.length === 1 ? `Review cycle still to send: ${unsent[0].client.name}` : `${unsent.length} review cycles still to send`,
    html: shell('Review cycles still to send', 'These are due this week and haven\'t gone out yet.', body)
  })
  return { sent: true, clients: unsent.length }
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
    const rows = await buildClientItems(today)
    const result = mode === 'monday' ? await sendMonday(rows, today) : await sendThursday(rows)
    return res.status(200).json({ mode, ...result })
  } catch (err) {
    console.error('team-reminders error:', err)
    return res.status(500).json({ error: err.message })
  }
}
