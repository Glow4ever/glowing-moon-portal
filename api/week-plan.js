// api/week-plan.js
//
// The one place the browser asks "what is due?". Reads the same source as
// the Monday email (_weekitems.js, built on weekPlan in _cadence.js), so the
// This Week page and the email always match item for item.
//
//   GET                       the plan for every client. Each row says
//                             whether the signed-in person manages it, so
//                             the page can list theirs first.
//   POST {action:'mark_call_booked', clientId}
//                             clears the quarterly call reminder. Admin or
//                             editor.
//   POST {action:'preview', client:{...}}
//                             admin only. One line describing this week for
//                             the dates typed into the Edit panel.

const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const { iso, addDays, todayUTC, mondayOnOrBefore, weekPlan, shortDate } = require('./_cadence')
const { buildWeek } = require('./_weekitems')
const { loadTeam } = require('./_team')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function previewText(plan) {
  if (plan.status === 'onboarding') return 'Onboarding. Delivery clock is off.'
  if (plan.status === 'upcoming') return 'Delivery starts ' + shortDate(plan.startsOn) + '.'
  return 'This week is week ' + plan.cycle.weekInCycle + ' of 4 (' + plan.weekLabel.replace(/ week$/, '') + ').' +
    (plan.nextDelivery ? ' Next delivery: ' + shortDate(plan.nextDelivery) + '.' : '')
}

function serialize(client, plan, items, owner, draftReady, mine) {
  return {
    clientId: client.id,
    name: client.name,
    slug: client.slug,
    ownerId: client.account_manager_id || null,
    ownerEmail: owner ? owner.email : null,
    mine,
    status: plan.status,
    chip: plan.chip,
    weekLabel: plan.weekLabel,
    weekInCycle: plan.cycle ? plan.cycle.weekInCycle : null,
    quarter: plan.quarter ? {
      number: plan.quarter.quarterNumber,
      weekInQuarter: plan.quarter.weekInQuarter,
      endsOn: iso(plan.quarter.quarterEnd),
      endsLabel: shortDate(plan.quarter.quarterEnd),
    } : null,
    nextDelivery: plan.nextDelivery ? iso(plan.nextDelivery) : null,
    nextDeliveryLabel: plan.nextDelivery ? shortDate(plan.nextDelivery) : null,
    startsOnLabel: plan.startsOn ? shortDate(plan.startsOn) : null,
    items: items.map(i => ({
      kind: i.kind,
      text: i.text,
      done: !!i.done,
      draftReady: i.kind === 'report' ? draftReady : undefined,
    })),
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('role, client_id')
      .eq('user_id', user.id)
      .is('client_id', null)
    const isAdmin = (roleRows || []).some(r => r.role === 'admin')
    const isEditor = (roleRows || []).some(r => r.role === 'editor')
    if (!isAdmin && !isEditor) return res.status(403).json({ error: 'Forbidden' })

    if (req.method === 'POST') {
      const body = req.body || {}

      if (body.action === 'preview') {
        if (!isAdmin) return res.status(403).json({ error: 'Forbidden' })
        const c = body.client || {}
        const plan = weekPlan({
          primary_frame: c.primary_frame || 'operations',
          retainer_start_date: c.retainer_start_date || null,
          delivery_start_date: c.delivery_start_date || null,
        }, todayUTC())
        return res.status(200).json({ text: previewText(plan) })
      }

      if (body.action === 'mark_call_booked') {
        if (!body.clientId) return res.status(400).json({ error: 'clientId required' })
        const { data: client } = await supabase
          .from('clients').select('id').eq('id', body.clientId).maybeSingle()
        if (!client) return res.status(404).json({ error: 'Client not found' })
        const { error } = await supabase
          .from('clients').update({ quarterly_call_booked_at: new Date().toISOString() }).eq('id', client.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true })
      }

      return res.status(400).json({ error: 'Unknown action' })
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

    const today = todayUTC()
    const [week, team, draftsRes] = await Promise.all([
      buildWeek(supabase, today),
      loadTeam(supabase),
      supabase.from('client_report_drafts').select('client_id').eq('status', 'pending'),
    ])
    const draftClients = new Set((draftsRes.data || []).map(d => d.client_id))
    const isMine = c => c.account_manager_id === user.id
    const ownerOf = c => team.find(m => m.user_id === c.account_manager_id) || null

    const rows = []
    for (const r of week.rows) {
      rows.push(serialize(r.client, r.plan, r.items, ownerOf(r.client), draftClients.has(r.client.id), isMine(r.client)))
    }
    for (const o of week.onboarding) {
      rows.push(serialize(o.client, o.plan, [], ownerOf(o.client), false, isMine(o.client)))
    }

    const monday = mondayOnOrBefore(today)
    return res.status(200).json({
      weekOf: iso(monday),
      weekOfLabel: shortDate(monday) + ' to ' + shortDate(addDays(monday, 6)),
      role: isAdmin ? 'admin' : 'editor',
      rows,
    })
  } catch (err) {
    console.error('week-plan error:', err)
    return res.status(500).json({ error: err.message })
  }
}
