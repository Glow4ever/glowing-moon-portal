const { requireAuth } = require('./_auth')

const { createClient } = require('@supabase/supabase-js')
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const ALLOWED_ENDPOINTS = [
  'files/list_folder',
  'files/list_folder/continue',
  'files/get_temporary_link',
  'files/get_metadata',
  'files/search_v2',
]

const ADMIN_ONLY_ENDPOINTS = [
  'files/delete_v2',
  'files/create_folder_v2',
  'files/move_v2',
  'files/copy_v2',
]

// Every allowed endpoint below except list_folder/continue takes a path
// somewhere in its body — this is where each one keeps it. Used to scope
// non-admin requests to the caller's own client folder. list_folder/continue
// is deliberately absent: it only takes a cursor, not a path, and a cursor
// can only be obtained by already having made a legitimately scoped
// list_folder call in the first place, so there's nothing to check here.
function getRequestedPath(endpoint, body) {
  if (endpoint === 'files/search_v2') return body?.options?.path
  return body?.path
}

// Client folders live at /Glowing Moon Portal/{clientName}/... — Dropbox
// paths are case-insensitive, so this comparison is too.
function pathBelongsToClient(path, clientName) {
  if (typeof path !== 'string' || !clientName) return false
  const prefix = `/glowing moon portal/${clientName.toLowerCase()}/`
  return path.toLowerCase().startsWith(prefix)
}

async function getAccessToken() {
  const refresh_token = process.env.DROPBOX_REFRESH_TOKEN
  const client_id = process.env.DROPBOX_APP_KEY
  const client_secret = process.env.DROPBOX_APP_SECRET

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id, client_secret })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  return data.access_token
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  const { endpoint, body } = req.body

  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' })

  const { data: roleRow } = await supabaseAdmin
    .from('user_roles')
    .select('role, client_id')
    .eq('user_id', user.id)
    .single()

  const isAdmin = roleRow?.role === 'admin' || roleRow?.role === 'editor'

  if (ADMIN_ONLY_ENDPOINTS.includes(endpoint) && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (!ALLOWED_ENDPOINTS.includes(endpoint) && !ADMIN_ONLY_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: 'Endpoint not permitted' })
  }

  // Path scoping — previously every allowed read endpoint trusted the
  // client-supplied path completely, meaning any authenticated member
  // could list, preview, or link any other client's folder just by naming
  // it. Admin/editor stay unrestricted since they're expected to reach
  // every client. Everyone else gets checked against their own client_id.
  if (!isAdmin && ALLOWED_ENDPOINTS.includes(endpoint) && endpoint !== 'files/list_folder/continue') {
    const requestedPath = getRequestedPath(endpoint, body)
    if (!requestedPath) {
      return res.status(400).json({ error: 'Missing path' })
    }

    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('name')
      .eq('id', roleRow?.client_id)
      .single()

    if (!clientRow || !pathBelongsToClient(requestedPath, clientRow.name)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  try {
    const ACCESS_TOKEN = await getAccessToken()

    const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({
          '.tag': 'namespace_id',
          namespace_id: '13502300579'
        })
      },
      body: JSON.stringify(body)
    })

    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch (e) {
      return res.status(response.status).json({ error: text })
    }

    if (!response.ok) return res.status(response.status).json(data)
    return res.status(200).json(data)
  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
