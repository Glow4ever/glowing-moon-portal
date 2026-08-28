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

// Link-preview crawlers fetch a URL automatically the instant it's pasted
// or scheduled anywhere — Facebook/Instagram/WhatsApp (facebookexternalhit),
// LinkedIn, Slack, Twitter/X, Discord, Telegram, and generic search bots all
// do this to generate a preview card. Confirmed live: EvoHealth's LinkedIn
// link showed 37 "clicks" that were actually facebookexternalhit fetching
// the same URL repeatedly within seconds — not real visitors. These still
// get redirected correctly (so the preview card renders the right page),
// they just don't count as a click.
const BOT_PATTERNS = [
  'facebookexternalhit', 'linkedinbot', 'twitterbot', 'slackbot',
  'telegrambot', 'whatsapp', 'discordbot', 'googlebot', 'bingbot',
  'bot', 'crawler', 'spider', 'preview', 'facebot', 'ia_archiver'
]

function isBotRequest(userAgent) {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_PATTERNS.some(pattern => ua.includes(pattern))
}

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
  // Skipped entirely for known preview-crawler bots — see BOT_PATTERNS above.
  if (!isBotRequest(req.headers['user-agent'])) {
    try {
      await supabase.from('link_clicks').insert({ link_id: link.id })
    } catch (err) {
      console.error(`Click log failed for slug ${slug}:`, err.message)
    }
  }

  return res.redirect(302, link.destination_url)
}
