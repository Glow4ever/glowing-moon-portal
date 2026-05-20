async function getAccessToken() {
  const refresh_token = process.env.DROPBOX_REFRESH_TOKEN
  const client_id = process.env.DROPBOX_APP_KEY
  const client_secret = process.env.DROPBOX_APP_SECRET

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id,
      client_secret
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  }
  return data.access_token
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { endpoint, body } = req.body

  try {
    const ACCESS_TOKEN = await getAccessToken()

    const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      'Dropbox-API-Select-User': 'dbid:AAAf19erhSWezY-8vQmLRzwCKlpH1ZF5OwE',
      },
      body: JSON.stringify(body)
    })

    const text = await response.text()

    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      console.error('Dropbox raw response:', text)
      return res.status(response.status).json({ error: text })
    }

    if (!response.ok) {
      console.error('Dropbox error:', data)
      return res.status(response.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
