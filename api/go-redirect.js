// api/go-redirect.js
//
// Public endpoint — anyone clicking a tracked link hits this. Looks up the
// slug, logs the click, redirects to the real destination. No auth check
// here on purpose: this needs to work for anonymous visitors clicking a
// link in a bio or caption, not just logged-in portal users.
//
// Uses the service role key to write the click log, since an anonymous
// visitor has no session — this is the one legitimate case for bypassing
// RLS entirely, matching how the cron functions already do it.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

module.exports = async function handler(req, res) {
  const { slug } = req.query
  if (!slug) return res.redirect(302, 'https://glowingmoonmedia.com')

  const { data: link } = await supabase
    .from('tracked_links')
    .select('id, destination_url')
    .eq('slug', slug)
    .maybeSingle()

  if (!link) {
    // Unknown slug — fail safe to the agency site rather than a bare 404,
    // so a mistyped or stale link doesn't dead-end a real visitor.
    return res.redirect(302, 'https://glowingmoonmedia.com')
  }

  // Log first, then redirect — if the click-log insert fails for any
  // reason, the visitor should still reach their destination. Tracking
  // failing silently is fine; sending someone to a dead link is not.
  try {
    await supabase.from('link_clicks').insert({ link_id: link.id })
  } catch (err) {
    console.error(`Click log failed for slug ${slug}:`, err.message)
  }

  return res.redirect(302, link.destination_url)
}
