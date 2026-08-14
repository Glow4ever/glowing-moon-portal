import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import styles from './Overview.module.css'
import { apiFetch } from '../lib/apiFetch'

async function listDropboxFolder(path) {
  const res = await apiFetch('/api/dropbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'files/list_folder', body: { path, include_deleted: false } })
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.entries || []
}

async function countDropboxFiles(path) {
  try {
    const entries = await listDropboxFolder(path)
    const counts = await Promise.all(entries.map(async entry => {
      if (entry['.tag'] === 'file') return 1
      if (entry['.tag'] === 'folder') return countDropboxFiles(entry.path_lower)
      return 0
    }))
    return counts.reduce((sum, n) => sum + n, 0)
  } catch { return 0 }
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PLATFORM_COLORS = {
  instagram: '#E06B5A',
  linkedin: '#378ADD',
  facebook: '#378ADD',
  twitter: '#888',
  tiktok: '#888',
  youtube: '#E06B5A',
}

function getRollingMonths() {
  const now = new Date()
  const months = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({ month: MONTH_NAMES[d.getMonth()], year: d.getFullYear() })
  }
  return months
}

function getStatusLabel(row) {
  // content_months.approval_status is orphaned as of the review_cycles
  // migration — sendForReview no longer writes to it, so any value here is
  // leftover from before and no longer trustworthy. Review status now lives
  // on review_cycles; this whole tile is flagged for a redesign later
  // (decision #7), so for now it's neutral rather than showing stale data.
  return { label: 'In Production', color: 'var(--text3)', bg: 'var(--surface3)', border: 'var(--border)' }
}

function isVideo(url) {
  return url && (url.endsWith('.mp4') || url.includes('/video/'))
}

export default function Overview() {
  const navigate = useNavigate()
  const { client, role } = useClient()
  const [stats, setStats] = useState({ assets: 0, content: 0, events: 0 })
  const [statsLoading, setStatsLoading] = useState(true)
  const [progressLoading, setProgressLoading] = useState(true)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [contentMonths, setContentMonths] = useState([])
  const [monthUploads, setMonthUploads] = useState({})
  const [monthScheduled, setMonthScheduled] = useState({})
  const [weekEvents, setWeekEvents] = useState([])
  const [metricoolPosts, setMetricoolPosts] = useState([])
  const [metricoolError, setMetricoolError] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(true)
  const [progressOpen, setProgressOpen] = useState(true)
  const [nextSteps, setNextSteps] = useState(null)
  const [perfHeadline, setPerfHeadline] = useState(null)
  const [perfLoading, setPerfLoading] = useState(true)

  useEffect(() => { loadDashboard() }, [client?.id])
  useEffect(() => { loadMetricoolPosts() }, [client?.id])

  async function loadMetricoolPosts() {
  try {
    const res = await apiFetch(`/api/metricool?clientId=${client?.id}`)
    if (!res.ok) {
      setMetricoolError(true)
      return
    }
    const data = await res.json()
    setMetricoolPosts(data.data || [])
    setMetricoolError(false)
  } catch (err) {
    console.error('Metricool error:', err)
    setMetricoolError(true)
  }
}

  function getMediaForDate(dateStr, network) {
    const match = metricoolPosts.find(post => {
      const postDate = post.publicationDate?.dateTime?.split('T')[0]
      if (postDate !== dateStr) return false
      if (!network) return true
      return post.providers?.some(p => p.network?.toLowerCase() === network.toLowerCase())
    })
    if (!match) return null
    return {
      url: match.media?.[0] || null,
      thumbnailUrl: match.videoThumbnailUrl || null
    }
  }

  async function loadDashboard() {
    if (!client) return
    setStatsLoading(true)
    setProgressLoading(true)
    setScheduleLoading(true)

    const clientName = client.name
    const basePath = `/Glowing Moon Portal/${clientName}`
    const rollingMonths = getRollingMonths()

    const today = new Date().toISOString().split('T')[0]
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Stat tiles: assets and content now read from stored Supabase counters
    // instead of walking Dropbox on every load. Counters are kept current by
    // incrementFileCount() calls in Content.jsx / Assets.jsx upload/delete handlers.
    setStats({
      assets: client.asset_count || 0,
      content: client.content_count || 0,
      events: 0
    })

    supabase
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('date', today)
      .then(({ count }) => {
        setStats(prev => ({ ...prev, events: count || 0 }))
        setStatsLoading(false)
      })

    // This week's schedule — independent of stats/progress, render as soon as it resolves
    supabase
      .from('calendar_events')
      .select('*')
      .eq('client_id', client.id)
      .gte('date', today)
      .lte('date', weekEnd)
      .order('date', { ascending: true })
      .limit(6)
      .then(({ data: weekData }) => {
        setWeekEvents(weekData || [])
        setScheduleLoading(false)
      })

    // Active review cycles — now loaded for every role, not just clients.
    // This is the data behind the new "Active review cycles" section,
    // replacing both the old member-only Next Steps banner and the old
    // static Content Progress panel with one real, shared view.
    const [{ data: cycleRows }, { data: unreadMessages }] = await Promise.all([
      supabase.from('review_cycles').select('*').eq('client_id', client.id).is('resolved_at', null),
      (role === 'member' || role === 'viewer')
        ? supabase.from('messages').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('sender', 'admin').eq('read', false)
        : Promise.resolve({ data: null })
    ])

    let activeCycles = []
    if (cycleRows && cycleRows.length > 0) {
      const cycleIds = cycleRows.map(c => c.id)
      const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
        supabase.from('file_status').select('cycle_id, status').in('cycle_id', cycleIds),
        // resolved = false is the fix here — this query used to count ANY
        // comment as "still needs revisions", including old ones already
        // marked resolved. Same bug class we already fixed in
        // recomputeCycleStage/loadStatusData, just missed here originally.
        supabase.from('file_comments').select('cycle_id').in('cycle_id', cycleIds).eq('resolved', false)
      ])
      const revisionCycles = new Set((commentRows || []).map(r => r.cycle_id))
      const rollupByCycle = {}
      ;(statusRows || []).forEach(r => {
        if (!rollupByCycle[r.cycle_id]) rollupByCycle[r.cycle_id] = { approved: 0, in_review: 0 }
        if (r.status === 'approved') rollupByCycle[r.cycle_id].approved++
        else rollupByCycle[r.cycle_id].in_review++
      })
      // Same formula used in Admin.jsx (loadCyclesByClient) and Content.jsx
      // (recomputeCycleStage) — kept identical on purpose so all three
      // surfaces agree on what stage a cycle is in.
      activeCycles = cycleRows
        .map(cycle => {
          const roll = rollupByCycle[cycle.id] || { approved: 0, in_review: 0 }
          const hasRevisions = revisionCycles.has(cycle.id)
          let derivedStage = 'in_review'
          if (hasRevisions) derivedStage = 'revisions'
          else if (roll.approved > 0 && roll.in_review === 0) derivedStage = 'approved'
          const effectiveStage = cycle.manual_override || derivedStage
          return { ...cycle, effectiveStage }
        })
        // Active means still open — approved cycles have nothing left to
        // show here. Admin/editor see both in_review and revisions;
        // client-side roles only see in_review (revisions means it's on
        // the admin now, not something the client needs to act on).
        .filter(cy => cy.effectiveStage !== 'approved')
        .filter(cy => (role === 'member' || role === 'viewer') ? cy.effectiveStage === 'in_review' : true)
        .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
    }

    const hasUnreadMessages = (unreadMessages?.count || 0) > 0
    setNextSteps({
      isPendingReview: activeCycles.length > 0,
      pendingCycles: activeCycles,
      hasUnreadMessages
    })

    // Performance teaser — real audience growth, same "best platform" logic
    // as the Metrics page hero, condensed to one headline. Independent of
    // the rest of this function so a slow/failed metrics fetch never blocks
    // the cycles or schedule sections from rendering.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    supabase
      .from('metric_snapshots')
      .select('platform, value, recorded_date')
      .eq('client_id', client.id)
      .eq('metric_type', 'audience')
      .gte('recorded_date', since)
      .order('recorded_date', { ascending: true })
      .then(({ data: snapRows }) => {
        const byPlatform = {}
        ;(snapRows || []).forEach(r => {
          if (!byPlatform[r.platform]) byPlatform[r.platform] = []
          byPlatform[r.platform].push(Number(r.value))
        })
        const deltas = Object.entries(byPlatform)
          .filter(([, values]) => values.length > 1)
          .map(([platform, values]) => ({ platform, delta: values[values.length - 1] - values[0] }))
          .filter(d => d.delta > 0)
          .sort((a, b) => b.delta - a.delta)
        if (deltas[0]) {
          const label = deltas[0].platform.charAt(0).toUpperCase() + deltas[0].platform.slice(1)
          setPerfHeadline(`+${Math.round(deltas[0].delta)} on ${label} this month`)
        } else {
          setPerfHeadline(null)
        }
        setPerfLoading(false)
      })

    const monthRowsPromise = supabase
      .from('content_months')
      .select('*')
      .eq('client_id', client.id)
      .in('month', rollingMonths.map(m => m.month))
      .in('year', rollingMonths.map(m => m.year))

    const monthDataPromise = Promise.all(rollingMonths.map(async ({ month, year }) => {
      const key = `${month} ${year}`
      const folderPath = `${basePath}/Content/${year}/${month}`
      const startDate = `${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2,'0')}-01`
      const endDate = new Date(year, MONTH_NAMES.indexOf(month) + 1, 0).toISOString().split('T')[0]

      const [uploaded, schedResult] = await Promise.all([
        countDropboxFiles(folderPath).catch(() => 0),
        supabase
          .from('calendar_events')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('date', startDate)
          .lte('date', endDate)
      ])

      return { key, uploaded, scheduled: schedResult.count || 0 }
    }))

    Promise.all([monthRowsPromise, monthDataPromise]).then(([{ data: monthRows }, monthData]) => {
      const uploadsMap = {}
      const scheduledMap = {}
      monthData.forEach(({ key, uploaded, scheduled }) => {
        uploadsMap[key] = uploaded
        scheduledMap[key] = scheduled
      })
      setContentMonths(monthRows || [])
      setMonthUploads(uploadsMap)
      setMonthScheduled(scheduledMap)
      setProgressLoading(false)
    })
  }

  const rollingMonths = getRollingMonths()

  function formatEventDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    const today = new Date().toISOString().split('T')[0]
    if (dateStr === today) return { label: 'Today', day: d.getDate() }
    return {
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      day: d.getDate()
    }
  }

  // Hides stale duplicate posts from "This Week's Schedule" the same way
  // Calendar.jsx does — see the long comment there for the full reasoning.
  // weekEvents only ever covers the next 7 days, well inside the live
  // endpoint's 30-day window, so no date-boundary check is needed here.
  const liveMetricoolIds = new Set(metricoolPosts.map(p => String(p.id)))
  const visibleWeekEvents = (metricoolError || metricoolPosts.length === 0)
    ? weekEvents
    : weekEvents.filter(e => !e.metricool_id || liveMetricoolIds.has(String(e.metricool_id)))

  return (
    <div className={styles.page}>

      <div className={styles.banner} style={client?.cover_url ? {
        backgroundImage: `linear-gradient(to right, var(--surface2) 35%, transparent 100%), url(${client.cover_url})`,
        backgroundSize: 'cover',
        backgroundPosition: `right ${client.cover_position || 'center'}`,
        backgroundRepeat: 'no-repeat'
      } : {}}>
        <div className={styles.bannerContent}>
          <div className={styles.bannerAvatar}>
            {client?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'GM'}
          </div>
          <div>
            <h2 className={styles.bannerTitle}>Welcome, {client?.name || 'Glowing Moon Media'}</h2>
            {client?.mission_statement ? (
              <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '17px', color: 'var(--text1)', maxWidth: '520px', lineHeight: '1.4', margin: '6px 0 10px' }}>
                "{client.mission_statement}"
              </p>
            ) : (
              <p className={styles.bannerSub}>Your brand is active and growing. Here's what's happening.</p>
            )}
            {client?.brand_pillars && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {client.brand_pillars.split(',').map(p => p.trim()).filter(Boolean).map(pillar => (
                  <span key={pillar} style={{ fontSize: '11px', background: 'rgba(211,201,167,0.16)', color: 'var(--gold-light)', padding: '4px 11px', borderRadius: '20px', border: '0.5px solid rgba(211,201,167,0.3)' }}>
                    {pillar}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '24px 0 10px' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--teal)', flexShrink: 0 }} />
        <div style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)' }}>Active review cycles</div>
      </div>

      {nextSteps && nextSteps.pendingCycles.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {nextSteps.pendingCycles.map(cycle => {
            const isRevisions = cycle.effectiveStage === 'revisions'
            return (
              <div key={cycle.id} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text1)' }}>{cycle.folder_label}</span>
                  <span style={{
                    fontSize: '11px', padding: '3px 10px', borderRadius: '20px',
                    background: isRevisions ? '#2a1a1a' : 'var(--gold-bg)',
                    color: isRevisions ? '#F0997B' : 'var(--gold-light)'
                  }}>
                    {isRevisions ? 'Revisions' : 'In review'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                  {role === 'admin' || role === 'editor'
                    ? (isRevisions ? 'Awaiting your response to client notes' : 'Awaiting client approval')
                    : (role === 'viewer' ? 'View files or leave feedback' : 'Approve files or leave revision notes')}
                </div>
                <button
                  onClick={() => navigate('/content', { state: { jumpToFolderPath: cycle.folder_path } })}
                  style={{ width: '100%', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', padding: '8px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' }}
                >
                  {role === 'viewer' ? 'View now' : (role === 'admin' || role === 'editor' ? 'Open folder' : 'Review now')} <i className="ti ti-arrow-right" style={{ marginLeft: '2px' }} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '18px 20px', marginBottom: '20px', fontSize: '13px', color: 'var(--text3)' }}>
          Nothing active right now — all caught up.
        </div>
      )}

      {(role === 'member' || role === 'viewer') && nextSteps?.hasUnreadMessages && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '14px 20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--teal-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ti ti-message" style={{ fontSize: '16px', color: 'var(--teal)' }} />
            </div>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--text1)', fontWeight: '500' }}>New message from Glowing Moon Media</div>
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Check your messages for updates</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/messages')}
            style={{ background: 'var(--teal)', color: '#0E0E0F', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            View messages →
          </button>
        </div>
      )}

      <div className={styles.grid}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className={styles.card} style={{ cursor: 'pointer' }} onClick={() => navigate('/metrics')}>
            <div className={styles.cardTitle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <i className="ti ti-trending-up" style={{ fontSize: '14px', color: 'var(--teal)' }} />Performance
              </span>
            </div>
            {perfLoading ? (
              <div className={styles.empty}>Loading...</div>
            ) : perfHeadline ? (
              <>
                <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text1)', margin: '4px 0 4px' }}>{perfHeadline}</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)' }}>View full metrics →</div>
              </>
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--text3)' }}>Tracking daily — trend lines fill in as more data comes through.</div>
            )}
          </div>
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <i className="ti ti-target-arrow" style={{ fontSize: '14px', color: 'var(--text3)' }} />ROI tracking
              </span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text2)', margin: '4px 0 4px' }}>In development</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)' }}>Booking conversions and link performance, coming soon</div>
          </div>
        </div>

        <div className={styles.card}>
          <div
            className={styles.cardTitle}
            onClick={() => setScheduleOpen(p => !p)}
            style={{ cursor: 'pointer', justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span className={styles.goldLine} />This week's schedule
            </span>
            <i className={`ti ti-chevron-${scheduleOpen ? 'up' : 'down'}`} style={{ fontSize: '13px' }} />
          </div>
          {metricoolError && (
            <div style={{ fontSize: '12px', color: 'var(--coral, #D85A30)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className="ti ti-plug-connected-x" style={{ fontSize: '13px' }} />
              Post previews may be missing — having trouble connecting right now.
            </div>
          )}
          {scheduleOpen && (
            <>
              {scheduleLoading && <div className={styles.empty}>Loading...</div>}
              {!scheduleLoading && visibleWeekEvents.length === 0 && (
                <div className={styles.empty}>
                  <i className="ti ti-calendar-off" style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text3)' }} />
                  No posts scheduled this week
                </div>
              )}
              {visibleWeekEvents.map((e, i) => {
                const { label, day } = formatEventDate(e.date)
                const platform = (e.notes || '').toLowerCase()
                const color = PLATFORM_COLORS[platform] || 'var(--text3)'
                const media = getMediaForDate(e.date, platform)
                return (
                  <div key={i} className={styles.scheduleItem} onClick={() => navigate('/calendar')}>
                    {media?.url ? (
                      isVideo(media.url) ? (
                        media.thumbnailUrl ? (
                          <div className={styles.scheduleThumbnailVideo} style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
                            <img
                              src={media.thumbnailUrl}
                              alt=""
                              className={styles.scheduleThumbnail}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              onError={e => { e.target.style.display = 'none' }}
                            />
                            <i className="ti ti-player-play-filled" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#fff', fontSize: '16px', textShadow: '0 1px 4px rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
                          </div>
                        ) : (
                          <div className={styles.scheduleThumbnailVideo} style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
                            <video
                              src={`${media.url}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                              className={styles.scheduleThumbnail}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              onError={e => { e.target.style.display = 'none' }}
                            />
                            <i className="ti ti-player-play-filled" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#fff', fontSize: '16px', textShadow: '0 1px 4px rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
                          </div>
                        )
                      ) : (
                        <img
                          src={media.url}
                          alt=""
                          className={styles.scheduleThumbnail}
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      )
                    ) : (
                      <div className={styles.scheduleThumbnailVideo}>
                        <i className="ti ti-photo" />
                      </div>
                    )}
                    <div className={styles.scheduleDate}>
                      <div className={styles.scheduleDateLabel}>{label}</div>
                      <div className={styles.scheduleDateNum}>{day}</div>
                    </div>
                    <div className={styles.scheduleBar} style={{ background: color }} />
                    <div className={styles.scheduleInfo}>
                      <div className={styles.scheduleName}>{e.title || e.post_name || 'Untitled'}</div>
                      <div className={styles.schedulePlatform} style={{ color }}>{e.notes || 'Post'}</div>
                    </div>
                    <i className="ti ti-arrow-right" style={{ fontSize: '12px', color: 'var(--text3)', flexShrink: 0 }} />
                  </div>
                )
              })}
            </>
          )}
        </div>

      </div>
    </div>
  )
}








