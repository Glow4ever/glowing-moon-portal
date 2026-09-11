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
//
// reachField (added later) was verified the same way, against
// /api/v2/analytics/posts/{platform} — a different, simpler endpoint than
// the timelines/aggregation pair above: one call returns every post in the
// window with its own stats already attached, no separate metric/subject
// params needed. The field name for "unique people reached" is NOT
// consistent across platforms, confirmed directly rather than assumed:
// Instagram calls it `reach` (verified against the live UI's own displayed
// average, exact match: 6). Facebook has no field literally named reach —
// `impressionsUnique` is the semantic equivalent (unique accounts served
// an impression). LinkedIn's equivalent is `uniqueImpressions`. YouTube has
// no unique-viewer field at all in this endpoint — only `views` (total
// plays, counts repeat views from the same person) — so YouTube's reach
// number is honestly a total-plays proxy, not true unique reach, same
// category of gap as YouTube's missing engagement metric above.

const PLATFORM_CONFIG = {
  facebook: {
    audienceMetric: 'pageFollows',
    audienceParamName: 'subject',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'subject',
    engagementParamValue: 'posts',
    reachField: 'impressionsUnique',
    // Facebook and LinkedIn's /posts endpoint has no publishedAt field —
    // 'created' is the closest available and matches Instagram/YouTube's
    // publishedAt in an analytics endpoint returning already-live posts.
    dateField: 'created'
  },
  instagram: {
    audienceMetric: 'followers',
    audienceParamName: 'subject',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'subject',
    engagementParamValue: 'posts',
    reachField: 'reach',
    dateField: 'publishedAt'
  },
  linkedin: {
    audienceMetric: 'Followers', // capitalized — confirmed from live account, not a typo
    audienceParamName: 'metricType',
    audienceParamValue: 'account',
    engagementMetric: 'engagement',
    engagementParamName: 'metricType', // timelines uses metricType
    engagementParamValue: 'posts',
    reachField: 'uniqueImpressions',
    dateField: 'created'
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
    engagementMetric: null,
    // 'views' here is total plays, not unique viewers — no unique-reach
    // field exists for YouTube on this endpoint. Recorded anyway since a
    // total-plays proxy is more honest signal than omitting YouTube from
    // reach entirely, but this is NOT apples-to-apples with the other three
    // platforms' true-unique numbers.
    reachField: 'views',
    dateField: 'publishedAt'
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
    .select('id, name, metricool_blog_id, retainer_start_date, created_at')
    .not('metricool_blog_id', 'is', null)

  if (clientsError) {
    return res.status(500).json({ error: clientsError.message })
  }

  const userId = process.env.METRICOOL_USER_ID
  const to = new Date()
  const from = new Date(to.getTime() - 1 * 24 * 60 * 60 * 1000) // last 24h — cron runs daily
  const results = []

  for (const client of clients) {
    // Full history since the retainer began — reach and streak both need
    // this, unlike audience/engagement above which stay windowed to a
    // recent slice. Falls back to account creation if no retainer date is
    // set, so this never silently produces an empty window.
    const sinceStart = new Date(client.retainer_start_date || client.created_at)
    const publishDatesForClient = new Set()

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
          } else if (Object.keys(engagementData || {}).length === 0) {
            // Metricool returns a bare {} when nothing was published on this
            // platform within the window — nothing to aggregate engagement
            // over. That's a normal, expected state (confirmed by checking
            // the raw response directly), not a failure — logged quietly
            // rather than as an error, and no row written since there's
            // genuinely no reading to record.
            console.log(`${client.name} / ${platform}: no posts in this window, nothing to aggregate.`)
          } else {
            // Any other unexpected shape is still worth surfacing loudly.
            console.error(
              `Engagement data for ${client.name} / ${platform} was not a number — got:`,
              JSON.stringify(engagementData).slice(0, 300)
            )
          }
        }

        // Reach snapshot — pulls EVERY post since the retainer started,
        // not a recent window. This writes the current true total each
        // run (upsert overwrites today's row), the same read semantics
        // as audience's "latest value" rather than engagement's "sum of
        // daily deltas". That distinction matters: a post's reach keeps
        // growing for days after it publishes, so a narrow window that
        // only ever catches a post once, on its publish day, permanently
        // undercounts. Pulling full history every run means a post's
        // contribution to the total updates as it naturally gains reach,
        // and nothing gets double-counted since each day's write replaces
        // the previous total rather than adding to it.
        if (config.reachField) {
          const reachParams = {
            from: isoWithOffset(sinceStart),
            to: isoWithOffset(to),
            timezone: 'America/New_York',
            userId,
            blogId: client.metricool_blog_id
          }
          const postsData = await metricoolFetch(`/posts/${platform}`, reachParams)
          const posts = Array.isArray(postsData) ? postsData : (postsData?.data || [])

          posts.forEach(post => {
            // Confirmed live: this field is a nested {dateTime, timezone}
            // object on all four platforms, not a flat date string. The
            // original String(dateVal) coercion produced "[object Object]"
            // for every post, silently breaking streak calculation entirely
            // — every post collapsed to the same garbage non-date string.
            const dateVal = post[config.dateField]?.dateTime
            if (dateVal) publishDatesForClient.add(String(dateVal).slice(0, 10))
          })

          if (posts.length > 0) {
            const totalReach = posts.reduce((sum, post) => sum + (post[config.reachField] || 0), 0)
            await supabase.from('metric_snapshots').upsert({
              client_id: client.id,
              platform,
              metric_type: 'reach',
              value: totalReach,
              recorded_date: to.toISOString().slice(0, 10)
            }, { onConflict: 'client_id,platform,metric_type,recorded_date' })
          }
          // Zero posts across the ENTIRE retainer history (not just a
          // recent window) is the only case with nothing to write —
          // genuinely rare, and still not an error.
        }

        results.push({ client: client.name, platform, status: 'ok' })
      } catch (err) {
        // One platform/client failing shouldn't block the rest — log and
        // move on, same fail-forward pattern used elsewhere in this app.
        // "No X connection for blog" is expected for any client that isn't
        // actually set up on that platform (e.g. GMM has no YouTube) — not
        // a bug, just noted for visibility rather than treated as alarming.
        const isMissingConnection = /no .* connection for blog/i.test(err.message)
        if (isMissingConnection) {
          console.log(`${client.name} / ${platform}: not connected in Metricool, skipping.`)
        } else {
          console.error(`Metrics pull failed for ${client.name} / ${platform}:`, err.message)
        }
        results.push({ client: client.name, platform, status: isMissingConnection ? 'not_connected' : 'error', message: err.message })
      }
    }

    // Publish streak — consecutive ISO weeks (Monday-start), counting
    // back from the current week, with a post on ANY platform. Built
    // from real publish dates pulled fresh this run, not from
    // calendar_events — that table is a rolling scheduling window that
    // gets pruned (confirmed live: 158 of EvoHealth's past events were
    // sitting in calendar_prune_candidates the day this was diagnosed),
    // so it can't be trusted as publishing history.
    try {
      const weekKey = dateStr => {
        const d = new Date(dateStr + 'T00:00:00Z')
        const day = (d.getUTCDay() + 6) % 7
        d.setUTCDate(d.getUTCDate() - day)
        return d.toISOString().slice(0, 10)
      }
      const postedWeeks = new Set([...publishDatesForClient].map(weekKey))
      const todayKey = weekKey(new Date().toISOString().slice(0, 10))
      let streak = 0
      let cursor = new Date()
      cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7))
      while (true) {
        const key = cursor.toISOString().slice(0, 10)
        if (!postedWeeks.has(key)) {
          // Don't break the streak just because the current week hasn't
          // published yet — only count it as a miss once the week ends.
          if (key === todayKey) {
            cursor.setUTCDate(cursor.getUTCDate() - 7)
            continue
          }
          break
        }
        streak++
        cursor.setUTCDate(cursor.getUTCDate() - 7)
      }
      await supabase.from('clients').update({ publish_streak_weeks: streak }).eq('id', client.id)
    } catch (err) {
      console.error(`Streak computation failed for ${client.name}:`, err.message)
    }
  }

  // Auto-retire: check every occurrence that's been sitting at
  // 'scheduled' for a while and see whether Metricool has actually
  // confirmed it live yet. Gated on scheduled_at (a real timestamptz, no
  // ambiguity) rather than the occurrence's own publish_date (a wall-clock
  // string with a separate timezone field, not something worth doing date
  // math against here) -- an hour past being sent to Metricool is a
  // reasonable point to start checking, not a claim about exactly when it
  // published.
  //
  // Only 'PUBLISHED' is a confirmed real status string, verified against a
  // live post earlier in this feature's build. No failure-status string
  // has been confirmed the same way, so this treats anything that is
  // neither 'PENDING' nor 'PUBLISHED' as worth surfacing as a failure
  // rather than silently retrying forever -- worth revisiting once a real
  // failure has actually been observed and its status string confirmed.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: scheduledOccurrences } = await supabase
      .from('schedule_drafts')
      .select('id, metricool_post_ids, client_id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', oneHourAgo)

    const clientBlogIds = {}
    for (const client of clients) clientBlogIds[client.id] = client.metricool_blog_id

    for (const occ of scheduledOccurrences || []) {
      const blogId = clientBlogIds[occ.client_id]
      if (!blogId) continue

      const postIds = [...new Set(Object.values(occ.metricool_post_ids || {}))]
      if (postIds.length === 0) continue

      try {
        const statuses = []
        for (const postId of postIds) {
          const params = new URLSearchParams({ userId, blogId: String(blogId) })
          const res = await fetch(`https://app.metricool.com/api/v2/scheduler/posts/${postId}?${params}`, {
            headers: { 'X-Mc-Auth': process.env.METRICOOL_API_TOKEN }
          })
          if (!res.ok) continue
          const post = await res.json()
          for (const provider of post.providers || []) statuses.push(provider.status)
        }

        if (statuses.length === 0) continue

        const allPublished = statuses.every(s => s === 'PUBLISHED')
        const anyUnrecognized = statuses.some(s => s !== 'PENDING' && s !== 'PUBLISHED')

        if (allPublished) {
          await supabase.from('schedule_drafts').update({ status: 'published', active: false }).eq('id', occ.id)
        } else if (anyUnrecognized) {
          await supabase.from('schedule_drafts').update({
            status: 'failed',
            schedule_error: `Unrecognized provider status: ${statuses.join(', ')}`
          }).eq('id', occ.id)
        }
        // Still PENDING across the board -- leave it as 'scheduled' and
        // check again next cron cycle.
      } catch (err) {
        console.error(`Auto-retire check failed for occurrence ${occ.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Auto-retire sweep failed:', err.message)
  }

  return res.status(200).json({ ranAt: new Date().toISOString(), results })
}
