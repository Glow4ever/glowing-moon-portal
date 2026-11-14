// api/banks.js
//
// Content banks per quarter (Session 5a). Team only.
//   GET  ?clientId=...                 { quarter, banks, needsBank }
//   POST { clientId, folder: {path, name} }   set this quarter's bank

const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const { ensureBanks, setBank } = require('./_quarter-history')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return

  const { data: roles } = await supabase.from('user_roles').select('client_id, role').eq('user_id', user.id)
  const team = (roles || []).some(r => !r.client_id && (r.role === 'admin' || r.role === 'editor'))
  if (!team) return res.status(403).json({ error: 'Only the team can manage content banks.' })

  const clientId = req.method === 'GET' ? req.query.clientId : (req.body || {}).clientId
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle()
  if (!client) return res.status(404).json({ error: 'Client not found.' })

  try {
    if (req.method === 'POST') {
      const folder = (req.body || {}).folder || {}
      if (typeof folder.path !== 'string' || !folder.path.startsWith('/')) return res.status(400).json({ error: 'Pick a folder.' })
      await setBank(supabase, client, { path: folder.path, name: String(folder.name || '').slice(0, 200) }, user.id)
      const { data: fresh } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle()
      return res.status(200).json({ ok: true, ...(await ensureBanks(supabase, fresh || client)) })
    }
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, ...(await ensureBanks(supabase, client)) })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('banks error:', err)
    return res.status(500).json({ error: 'Something went wrong.' })
  }
}
