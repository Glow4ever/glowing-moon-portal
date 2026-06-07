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

    const rootNamespace = process.env.DROPBOX_ROOT_NAMESPACE
    const zipRes = await fetch('https://content.dropboxapi.com/2/files/download_zip', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
        'Content-Type': 'text/plain',
        ...(rootNamespace ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', 'namespace_id': rootNamespace }) } : {})
      }
    })

    if (!zipRes.ok) {
      const err = await zipRes.text()
      return res.status(500).json({ error: err })
    }

    const folderName = path.split('/').pop()
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`)

    const buffer = await zipRes.arrayBuffer()
    res.send(Buffer.from(buffer))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
