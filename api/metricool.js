module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { start, end } = req.query

  const userId = process.env.METRICOOL_USER_ID
  const blogId = process.env.METRICOOL_BLOG_ID
  const token = process.env.METRICOOL_API_TOKEN

  if (!userId || !blogId || !token) {
    return res.status(500).json({ error: 'Metricool env vars not set' })
  }

 const params = new URLSearchParams({
  userId,
  blogId,
  start: start || new Date().toISOString().split('T')[0],
  end: end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  timezone: 'America/New_York'
})

    const response = await fetch(
      `https://app.metricool.com/api/v2/scheduler/posts?${params}`,
      {
        method: 'GET',
        headers: {
          'X-Mc-Auth': token,
          'Content-Type': 'application/json'
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Metricool error:', data)
      return res.status(response.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('Metricool handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
