// api/metricool-analytics.js
//
// Pulls audience growth + engagement data from Metricool's analytics API
// (a different surface than api/metricool.js, which only handles the
// scheduler/posts data behind the calendar). Writes into metric_snapshots.
//
// Runs on a schedule via Vercel Cron (see vercel.json) — no Make.com
// involved. Auth pattern matches api/metricool.js: X-Mc-Auth header with
// the Metricool userToken, plus userId + blogId query params on every call.
//
// PLATFORM_CONFIG below was built from real requests captured directly off
// the live Metricool account (browser network inspection), not from
// secondhand docs — each platform genuinely uses different metric names and
// even different query param names for the same concept. LinkedIn is the
// clearest example: it uses `metricType` instead of `subject` on the
// timelines endpoint, but Metricool's own API switches back to `subject` on
// the aggregation endpoint for the exact same platform. That's their
// inconsistency, not a bug here — verified directly, not assumed.
//
// TikTok is NOT in this config yet since no connected client has it
// verified — don't add a platform below without capturing its real
// metric/param names the same way (browser network tab, Analytics section,
// per platform) rather than guessing from the pattern of platforms already
// confirmed. Facebook, Instagram, LinkedIn, and YouTube are all verified
// directly against a live account.

const PLATFORM_CONFIG = {
  facebook: {
    audienceMetric: 'pageFollows',
    audienceParamName: 'subject',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'subject',
    engagementParamValue: 'posts'
  },
  instagram: {
    audienceMetric: 'followers',
    audienceParamName: 'subject',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'subject',
    engagementParamValue: 'posts'
  },
  linkedin: {
    audienceMetric: 'Followers', // capitalized — confirmed from live account, not a typo
    audienceParamName: 'metricType',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'metricType', // timelines uses metricType
    engagementParamValue: 'posts'
  },
  youtube: {
    audienceMetric: 'totalSubscribers',
    audienceParamName: 'subject',
    audienceParamValue: 'account',
    // No engagement pull for YouTube — confirmed there's no equivalent
    // aggregation endpoint for it at all (verified via live network
    // inspection, not assumed). YouTube only exposes raw counts (views,
    // likes, dislikes, comments, shares), not a single engagement figure —
    // even Metricool's own dashboard doesn't show one. Computing our own
    // engagement formula from those raw counts is possible later, but that's
    // a real decision (which counts, what denominator) worth making
    // deliberately rather than silently inventing a number here.
    engagementMetric: null
  }
}

const METRICOOL_BASE = 'https://app.metricool.com/api/v2/analytics'

async function metricoolFetch(path, params) {
  const url = `${METRICOOL_BASE}${path}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, {
    headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
  })
  if (!res.ok) {
    throw new Error(`Metricool ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

function isoWithOffset(date) {
  // Metricool's timelines endpoint wants a timezone-offset ISO string, not
  // plain UTC — matches the exact format seen in captured requests
  // (e.g. "2026-07-12T00:00:00-04:00").
  return date.toISOString().slice(0, 19)
}

export default async function handler(req, res) {
  // Same protection pattern as other scheduled functions — Vercel Cron
  // sends this header automatically; reject anything else so this can't be
  // triggered by a stray public request.
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, metricool_blog_id')
    .not('metricool_blog_id', 'is', null)

  if (clientsError) {
    return res.status(500).json({ error: clientsError.message })
  }

  const userId = process.env.METRICOOL_USER_ID
  const to = new Date()
  const from = new Date(to.getTime() - 1 * 24 * 60 * 60 * 1000) // last 24h — cron runs daily
  const results = []

  for (const client of clients) {
    for (const [platform, config] of Object.entries(PLATFORM_CONFIG)) {
      try {
        // Audience snapshot
        const audienceParams = {
          from: isoWithOffset(from),
          to: isoWithOffset(to),
          metric: config.audienceMetric,
          network: platform,
          timezone: 'America/New_York',
          userId,
          blogId: client.metricool_blog_id
        }
        audienceParams[config.audienceParamName] = config.audienceParamValue
        const audienceData = await metricoolFetch('/timelines', audienceParams)
        const latestAudience = audienceData?.data?.[0]?.values?.slice(-1)?.[0]

        if (latestAudience) {
          await supabase.from('metric_snapshots').upsert({
            client_id: client.id,
            platform,
            metric_type: 'audience',
            value: latestAudience.value,
            recorded_date: latestAudience.dateTime.slice(0, 10)
          }, { onConflict: 'client_id,platform,metric_type,recorded_date' })
        }

        // Engagement snapshot — using aggregation, a single number for the
        // window, since engagement rate is more meaningful as a period
        // summary than a raw daily count. Skipped entirely for platforms
        // with no engagement metric configured (currently just YouTube).
        if (config.engagementMetric) {
          const engagementParams = {
            from: isoWithOffset(from),
            to: isoWithOffset(to),
            metric: config.engagementMetric,
            network: platform,
            timezone: 'America/New_York',
            subject: config.engagementParamValue, // aggregation always uses `subject`, confirmed across all 3 platforms that have it
            userId,
            blogId: client.metricool_blog_id
          }
          const engagementData = await metricoolFetch('/aggregation', engagementParams)

          if (typeof engagementData?.data === 'number') {
            await supabase.from('metric_snapshots').upsert({
              client_id: client.id,
              platform,
              metric_type: 'engagement',
              value: engagementData.data,
              recorded_date: to.toISOString().slice(0, 10)
            }, { onConflict: 'client_id,platform,metric_type,recorded_date' })
          }
        }

        results.push({ client: client.name, platform, status: 'ok' })
      } catch (err) {
        // One platform/client failing shouldn't block the rest — log and
        // move on, same fail-forward pattern used elsewhere in this app.
        console.error(`Metrics pull failed for ${client.name} / ${platform}:`, err.message)
        results.push({ client: client.name, platform, status: 'error', message: err.message })
      }
    }
  }

  return res.status(200).json({ ranAt: new Date().toISOString(), results })
}
