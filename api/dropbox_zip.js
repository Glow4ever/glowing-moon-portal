module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { path } = req.body
  if (!path) return res.status(400).json({ error: 'No path provided' })
  const token = process.env.DROPBOX_REFRESH_TOKEN
  const clientId = process.env.DROPBOX_APP_KEY
  const clientSecret = process.env.DROPBOX_APP_SECRET
  try {
    const tokenRes = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
        client_secret: clientSecret
      })
    })
    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token
    const shareRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', 'namespace_id': '13502300579' })
      },
      body: JSON.stringify({
        path,
        settings: { requested_visibility: 'public' }
      })
    })
    const shareText = await shareRes.text()
    let shareData
    try { shareData = JSON.parse(shareText) } catch(e) { return res.status(500).json({ error: 'Dropbox response: ' + shareText.slice(0, 300) }) }
    if (shareData.error?.['.tag'] === 'shared_link_already_exists') {
      const existingRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', 'namespace_id': '13502790915' })
        },
        body: JSON.stringify({ path, direct_only: true })
      })
      const existingData = await existingRes.json()
      shareData = existingData.links?.[0]
    }
    if (!shareData?.url) {
      return res.status(500).json({ error: 'Could not generate share link' })
    }
    const zipUrl = shareData.url.split('?')[0] + '?d1=1'
    return res.status(200).json({ url: zipUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
