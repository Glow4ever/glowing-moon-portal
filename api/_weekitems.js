// api/_weekitems.js
//
// What is due this week, per client, in the exact words the Monday email and
// the This Week page both use. Built from weekPlan (see _cadence.js), so
// neither of them works out the week on its own.
//
// A review counts as sent the moment a review cycle is created for that
// client during the week. Nothing needs ticking off.

const { iso, addDays, weekPlan } = require('./_cadence')

async function buildWeek(supabase, today) {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, name, slug, active, primary_frame, retainer_start_date, delivery_start_date, quarterly_call_booked_at, account_manager_id')
    .order('name')
  if (error) throw new Error(error.message)

  const rows = []
  const onboarding = []
  for (const client of clients || []) {
    if (client.active === false) continue
    const plan = weekPlan(client, today)
    if (plan.status !== 'active') {
      onboarding.push({ client, plan })
      continue
    }
    const cad = plan.cycle
    const items = []
    for (const it of plan.items) {
      if (it.kind === 'delivery') {
        const { count } = await supabase
          .from('review_cycles')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('sent_at', iso(cad.weekStart))
          .lt('sent_at', iso(addDays(cad.weekEnd, 1)))
        items.push({ kind: 'review', done: (count || 0) > 0, text: it.text })
      } else if (it.kind === 'note') {
        items.push({ kind: 'report', text: 'Two-week note goes out (draft arrives by email)' })
      } else if (it.kind === 'report') {
        const isOps = plan.template === 'operational'
        items.push({ kind: 'report', text: isOps ? 'Monthly recap goes out (write your summary first)' : 'Monthly report goes out (draft arrives by email)' })
      } else {
        items.push({ kind: 'call', text: it.text })
      }
    }
    rows.push({ client, plan, cad, items })
  }
  return { rows, onboarding }
}

module.exports = { buildWeek }
