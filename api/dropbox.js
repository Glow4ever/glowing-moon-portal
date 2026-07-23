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
    .select('role')
    .eq('user_id', user.id)
    .single()

  const isAdmin = roleRow?.role === 'admin' || roleRow?.role === 'editor'

  if (ADMIN_ONLY_ENDPOINTS.includes(endpoint) && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (!ALLOWED_ENDPOINTS.includes(endpoint) && !ADMIN_ONLY_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: 'Endpoint not permitted' })
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
