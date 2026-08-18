const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return

  const userId = process.env.METRICOOL_USER_ID
  const token = process.env.METRICOOL_API_TOKEN

  if (!userId || !token) return res.status(500).json({ error: 'Metricool env vars not set' })

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role, client_id')
    .eq('user_id', user.id)
    .single()

  const isAdmin = roleRow?.role === 'admin' || roleRow?.role === 'editor'

  // Previously any authenticated user could pass any clientId (or even a
  // raw blogId directly) and pull another client's scheduled posts —
  // unpublished captions, images, publish dates. Admin/editor keep the
  // original override behavior since they're expected to view any client.
  // Everyone else is forced onto their own client's blog_id, full stop —
  // the request's own blogId/clientId params are ignored for them rather
  // than validated, since there's no legitimate reason a member account
  // would ever need to specify a different one.
  let blogId

  if (isAdmin) {
    blogId = req.query.blogId

    if (!blogId && req.query.clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('metricool_blog_id')
        .eq('id', req.query.clientId)
        .single()
      blogId = client?.metricool_blog_id
    }

    if (!blogId) blogId = process.env.METRICOOL_BLOG_ID
  } else {
    if (!roleRow?.client_id) return res.status(403).json({ error: 'Forbidden' })
    const { data: client } = await supabase
      .from('clients')
      .select('metricool_blog_id')
      .eq('id', roleRow.client_id)
      .single()
    blogId = client?.metricool_blog_id
    if (!blogId) return res.status(403).json({ error: 'Forbidden' })
  }

  const { start, end } = req.query
  const startDate = start || new Date().toISOString().split('T')[0] + 'T00:00:00'
  const endDate = end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T23:59:59'

  const url = `https://app.metricool.com/api/v2/scheduler/posts?userId=${userId}&blogId=${blogId}&start=${startDate}&end=${endDate}&timezone=America/New_York`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Mc-Auth': token, 'Content-Type': 'application/json' }
    })

    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    return res.status(200).json(data)
  } catch (err) {
    console.error('Metricool handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
