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
  const ACCESS_TOKEN = process.env.VITE_DROPBOX_ACCESS_TOKEN
  const MEMBER_ID = process.env.VITE_DROPBOX_MEMBER_ID

  try {
    const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Select-User': MEMBER_ID,
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
