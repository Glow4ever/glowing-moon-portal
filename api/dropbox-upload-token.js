const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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

  const { data: roleRow } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  const isAdmin = roleRow?.role === 'admin'
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' })

  try {
    const accessToken = await getAccessToken()
    return res.status(200).json({
      accessToken,
      namespaceId: '13502300579'
    })
  } catch (err) {
    console.error('Upload token error:', err)
    return res.status(500).json({ error: err.message })
  }
}
