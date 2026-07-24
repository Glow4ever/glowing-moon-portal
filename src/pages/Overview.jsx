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
  if (!row) return { label: 'In Production', color: 'var(--text3)', bg: 'var(--surface3)', border: 'var(--border)' }
  if (row.approval_status === 'approved') return { label: 'Approved', color: 'var(--teal)', bg: 'var(--teal-bg)', border: 'rgba(58,158,130,0.25)' }
  if (row.approval_status === 'pending') return { label: 'Pending Review', color: 'var(--gold-light)', bg: 'var(--gold-bg)', border: 'var(--gold-border)' }
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
  const [scheduleOpen, setScheduleOpen] = useState(true)
  const [progressOpen, setProgressOpen] = useState(true)
  const [nextSteps, setNextSteps] = useState(null)

  useEffect(() => { loadDashboard() }, [client?.id, client?.approval_status])
  useEffect(() => { loadMetricoolPosts() }, [])

  async function loadMetricoolPosts() {
  try {
    const res = await apiFetch(`/api/metricool?clientId=${client?.id}`)
    if (!res.ok) return
    const data = await res.json()
    setMetricoolPosts(data.data || [])
  } catch (err) {
    console.error('Metricool error:', err)
  }
}

  function getMediaForDate(dateStr, network) {
    const match = metricoolPosts.find(post => {
      const postDate = post.publicationDate?.dateTime?.split('T')[0]
      if (postDate !== dateStr) return false
      if (!network) return true
      return post.providers?.some(p => p.network?.toLowerCase() === network.toLowerCase())
    })
    return match?.media?.[0] || null
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

    // Next Steps — pending approvals + unread messages for member view
    if (role === 'member') {
      const [{ data: fileStatusRows }, { data: commentRows }, { data: unreadMessages }] = await Promise.all([
        supabase.from('file_status').select('status').eq('client_id', client.id).eq('status', 'approved'),
        supabase.from('file_comments').select('file_path').eq('client_id', client.id),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('sender', 'admin').eq('read', false)
      ])
      const isPendingReview = client.approval_status === 'pending'
      const hasUnreadMessages = (unreadMessages?.count || 0) > 0
      setNextSteps({
        isPendingReview,
        approvalFolderPath: client.approval_folder_path,
        approvalMonth: client.approval_month,
        hasUnreadMessages
      })
    }
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
            <p className={styles.bannerSub}>Your brand is active and growing. Here's what's happening.</p>
          </div>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard} onClick={() => navigate('/assets')} style={{ cursor: 'pointer' }}>
          <div className={styles.statLabel}>
            <i className="ti ti-folder" style={{ fontSize: '13px', color: 'var(--gold-light)' }} />
            Asset Library
          </div>
          <div className={styles.statVal}>{statsLoading ? '—' : stats.assets}</div>
          <div className={styles.statSub}>Brand files & templates</div>
          <div className={styles.statLink}>View library →</div>
        </div>
        <div className={styles.statCard} onClick={() => navigate('/content')} style={{ cursor: 'pointer' }}>
          <div className={styles.statLabel}>
            <i className="ti ti-photo" style={{ fontSize: '13px', color: 'var(--teal)' }} />
            Content Library
          </div>
          <div className={styles.statVal}>{statsLoading ? '—' : stats.content}</div>
          <div className={styles.statSub}>Photos & videos</div>
          <div className={styles.statLink} style={{ color: 'var(--teal)' }}>Review content →</div>
        </div>
        <div className={styles.statCard} onClick={() => navigate('/calendar')} style={{ cursor: 'pointer' }}>
          <div className={styles.statLabel}>
            <i className="ti ti-calendar" style={{ fontSize: '13px', color: 'var(--text2)' }} />
            Upcoming Posts
          </div>
          <div className={styles.statVal}>{statsLoading ? '—' : stats.events}</div>
          <div className={styles.statSub}>Scheduled ahead</div>
          <div className={styles.statLink} style={{ color: 'var(--text2)' }}>View calendar →</div>
        </div>
      </div>

      {role === 'member' && nextSteps && (nextSteps.isPendingReview || nextSteps.hasUnreadMessages) && (
        <div style={{
          background: 'var(--surface2)',
          border: `1px solid ${client?.primary_color || 'var(--gold-light)'}55`,
          borderRadius: '10px',
          padding: '20px 24px',
          marginBottom: '20px',
          boxShadow: `0 0 18px 0 ${client?.primary_color || '#D3C9A7'}22`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ width: '3px', height: '14px', background: 'var(--gold-light)', borderRadius: '2px', display: 'inline-block' }} />
            <div style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)' }}>Next Steps</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {nextSteps.isPendingReview && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '9px', background: 'var(--gold-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className="ti ti-file-check" style={{ fontSize: '18px', color: 'var(--gold-light)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', color: 'var(--text1)', fontWeight: '600' }}>
                      {nextSteps.approvalMonth} content is ready for your review
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      Approve files or leave revision notes
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/content', { state: { jumpToFolderPath: nextSteps.approvalFolderPath } })}
                  style={{ background: 'var(--gold-light)', color: '#0E0E0F', border: 'none', borderRadius: '7px', padding: '10px 20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Review Now <i className="ti ti-arrow-right" style={{ marginLeft: '2px' }} />
                </button>
              </div>
            )}
            {nextSteps.hasUnreadMessages && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--teal-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ti ti-message" style={{ fontSize: '16px', color: 'var(--teal)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text1)', fontWeight: '500' }}>
                      New message from Glowing Moon Media
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      Check your messages for updates
                    </div>
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
          </div>
        </div>
      )}

      <div className={styles.grid}>

        <div className={styles.card}>
          <div
            className={styles.cardTitle}
            onClick={() => setProgressOpen(p => !p)}
            style={{ cursor: 'pointer', justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span className={styles.goldLine} />Content Progress
            </span>
            <i className={`ti ti-chevron-${progressOpen ? 'up' : 'down'}`} style={{ fontSize: '13px' }} />
          </div>
          {progressOpen && (
            <>
              {progressLoading && <div className={styles.empty}>Loading...</div>}
              {!progressLoading && rollingMonths.map(({ month, year }) => {
                const key = `${month} ${year}`
                const row = contentMonths.find(r => r.month === month && r.year === year)
                const planned = row?.planned || 0
                const uploaded = monthUploads[key] || 0
                const approved = row?.approval_status === 'approved' ? planned : 0
                const scheduled = monthScheduled[key] || 0
                const hasScheduled = scheduled > 0
                const progress = planned > 0 ? Math.min(Math.round((uploaded / planned) * 100), 100) : 0
                const status = getStatusLabel(row)
                return (
                  <div key={key} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--gold-dim)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)' }}>{key}</span>
                      </div>
                      <span style={{ fontSize: '11px', padding: '2px 9px', borderRadius: '20px', background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>{status.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '20px', marginBottom: '10px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text)', fontFamily: "'Cormorant Garamond', serif" }}>{planned}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>Planned</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text)', fontFamily: "'Cormorant Garamond', serif" }}>{uploaded}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>Uploaded</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text)', fontFamily: "'Cormorant Garamond', serif" }}>{approved}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>Approved</div>
                      </div>
                      {hasScheduled && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text)', fontFamily: "'Cormorant Garamond', serif" }}>{scheduled}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>Scheduled</div>
                        </div>
                      )}
                    </div>
                    <div style={{ height: '3px', background: 'var(--border)', borderRadius: '99px' }}>
                      <div style={{ width: `${progress}%`, height: '3px', background: 'var(--gold-dim)', borderRadius: '99px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </>
          )}
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
          {scheduleOpen && (
            <>
              {scheduleLoading && <div className={styles.empty}>Loading...</div>}
              {!scheduleLoading && weekEvents.length === 0 && (
                <div className={styles.empty}>
                  <i className="ti ti-calendar-off" style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text3)' }} />
                  No posts scheduled this week
                </div>
              )}
              {weekEvents.map((e, i) => {
                const { label, day } = formatEventDate(e.date)
                const platform = (e.notes || '').toLowerCase()
                const color = PLATFORM_COLORS[platform] || 'var(--text3)'
                const mediaUrl = getMediaForDate(e.date, platform)
                return (
                  <div key={i} className={styles.scheduleItem} onClick={() => navigate('/calendar')}>
                    {mediaUrl ? (
                      isVideo(mediaUrl) ? (
                        <div className={styles.scheduleThumbnailVideo}>
                          <i className="ti ti-player-play" />
                        </div>
                      ) : (
                        <img
                          src={mediaUrl}
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




