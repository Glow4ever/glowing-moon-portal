// api/_auth.js
// Shared JWT verification for all Vercel API routes.
// Import and call requireAuth(req, res) at the top of each handler.
// Returns the decoded user payload on success, or sends 401 and returns null.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

async function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY
      }
    })

    if (!response.ok) {
      res.status(401).json({ error: 'Unauthorized' })
      return null
    }

    const user = await response.json()
    return user
  } catch (err) {
    console.error('Auth check failed:', err)
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
}

module.exports = { requireAuth }
