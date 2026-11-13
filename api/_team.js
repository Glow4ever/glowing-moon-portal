// api/_team.js
//
// Who is on the team, and who an email about a client should go to.
// Every client has one owner (clients.account_manager_id). Emails go to the
// owner with every admin copied. A client with no owner, or an owner who is
// no longer on the team, goes to the admin alone.
//
// Team members are the user_roles rows with no client_id (admin and editor).
// Their email is stored on the row, so no extra lookup is needed.

const FALLBACK = (process.env.TEAM_REMINDER_EMAILS || process.env.REPORT_NOTIFY_EMAIL || 'hector@glowingmoonmedia.com')
  .split(',').map(s => s.trim()).filter(Boolean)

async function loadTeam(supabase) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id, email, role, client_id')
    .in('role', ['admin', 'editor'])
    .is('client_id', null)
  if (error) throw new Error(error.message)
  const seen = new Set()
  const team = []
  for (const r of data || []) {
    if (!r.user_id || !r.email || seen.has(r.user_id)) continue
    seen.add(r.user_id)
    team.push({ user_id: r.user_id, email: r.email, role: r.role })
  }
  return team
}

// { to: [emails], cc: [emails], ownerId, ownerEmail, isOwnerEditor }
function routingFor(team, ownerId) {
  const admins = team.filter(m => m.role === 'admin').map(m => m.email)
  const owner = team.find(m => m.user_id === ownerId)
  if (!owner || owner.role === 'admin') {
    const to = admins.length ? admins : FALLBACK
    return { to, cc: [], ownerId: owner ? owner.user_id : null, ownerEmail: owner ? owner.email : null, isOwnerEditor: false }
  }
  return { to: [owner.email], cc: admins.filter(e => e !== owner.email), ownerId: owner.user_id, ownerEmail: owner.email, isOwnerEditor: true }
}

module.exports = { loadTeam, routingFor, FALLBACK }
