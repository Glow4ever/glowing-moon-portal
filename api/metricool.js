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

  let blogId = req.query.blogId

  if (!blogId && req.query.clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('metricool_blog_id')
      .eq('id', req.query.clientId)
      .single()
    blogId = client?.metricool_blog_id
  }

  if (!blogId) blogId = process.env.METRICOOL_BLOG_ID

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
