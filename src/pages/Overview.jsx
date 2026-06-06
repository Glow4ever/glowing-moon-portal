import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import styles from './Overview.module.css'

async function listDropboxFolder(path) {
  const res = await fetch('/api/dropbox', {
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
    let count = 0
    for (const entry of entries) {
      if (entry['.tag'] === 'file') count++
      else if (entry['.tag'] === 'folder') count += await countDropboxFiles(entry.path_lower)
    }
    return count
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
  const { client } = useClient()
  const [stats, setStats] = useState({ assets: 0, content: 0, events: 0 })
  const [loading, setLoading] = useState(true)
  const [contentMonths, setContentMonths] = useState([])
  const [monthUploads, setMonthUploads] = useState({})
  const [monthScheduled, setMonthScheduled] = useState({})
  const [metricoolPosts, setMetricoolPosts] = useState([])
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [scheduleOpen, setScheduleOpen] = useState(true)
  const [progressOpen, setProgressOpen] = useState(true)

  useEffect(() => { loadDashboard() }, [client])
  useEffect(() => { loadMetricoolPosts() }, [])

  async function loadMetricoolPosts() {
    try {
      const res = await fetch('/api/metricool')
      if (!res.ok) return
      const data = await res.json()
      const posts = (data.data || [])
        .filter(p => p.media?.length > 0)
        .sort((a, b) => new Date(a.publicationDate.dateTime) - new Date(b.publicationDate.dateTime))
        .slice(0, 10)
      setMetricoolPosts(posts)
    } catch (err) {
      console.error('Metricool error:', err)
    }
  }

  async function loadDashboard() {
    if (!client) return
    setLoading(true)

    const clientName = client.name
    const basePath = `/Glowing Moon Portal/${clientName}`
    const rollingMonths = getRollingMonths()

    const [assetCount, contentCount] = await Promise.all([
      countDropboxFiles(`${basePath}/Assets`),
      countDropboxFiles(`${basePath}/Content`)
    ])

    const today = new Date().toISOString().split('T')[0]

    const { count } = await supabase
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('date', today)

    const { data: monthRows } = await supabase
      .from('content_months')
      .select('*')
      .eq('client_id', client.id)
      .in('month', rollingMonths.map(m => m.month))
      .in('year', rollingMonths.map(m => m.year))

    const uploadsMap = {}
    const scheduledMap = {}

    await Promise.all(rollingMonths.map(async ({ month, year }) => {
      const key = `${month} ${year}`
      const folderPath = `${basePath}/Content/${year}/${month}`
      const uploaded = await countDropboxFiles(folderPath).catch(() => 0)
      uploadsMap[key] = uploaded

      const startDate = `${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2,'0')}-01`
      const endDate = new Date(year, MONTH_NAMES.indexOf(month) + 1, 0).toISOString().split('T')[0]

      const { count: sched } = await supabase
        .from('calendar_events')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('date', startDate)
        .lte('date', endDate)

      scheduledMap[key] = sched || 0
    }))

    setStats({ assets: assetCount, content: contentCount, events: count || 0 })
    setContentMonths(monthRows || [])
    setMonthUploads(uploadsMap)
    setMonthScheduled(scheduledMap)
    setLoading(false)
  }

  const rollingMonths = getRollingMonths()

  function prevPost() {
    setCarouselIndex(i => Math.max(0, i - 1))
  }

  function nextPost() {
    setCarouselIndex(i => Math.min(metricoolPosts.length - 1, i + 1))
  }

  function formatPostDate(dateTime) {
    const d = new Date(dateTime)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const currentPost = metricoolPosts[carouselIndex]
  const platforms = currentPost?.providers?.map(p => p.network).join(', ') || ''

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
          <div className={styles.statVal}>{loading ? '—' : stats.assets}</div>
          <div className={styles.statSub}>Brand files & templates</div>
          <div className={styles.statLink}>View library →</div>
        </div>
        <div className={styles.statCard} onClick={() => navigate('/content')} style={{ cursor: 'pointer' }}>
          <div className={styles.statLabel}>
            <i className="ti ti-photo" style={{ fontSize: '13px', color: 'var(--teal)' }} />
            Content Library
          </div>
          <div className={styles.statVal}>{loading ? '—' : stats.content}</div>
          <div className={styles.statSub}>Photos & videos</div>
          <div className={styles.statLink} style={{ color: 'var(--teal)' }}>Review content →</div>
        </div>
        <div className={styles.statCard} onClick={() => navigate('/calendar')} style={{ cursor: 'pointer' }}>
          <div className={styles.statLabel}>
            <i className="ti ti-calendar" style={{ fontSize: '13px', color: 'var(--text2)' }} />
            Upcoming Posts
          </div>
          <div className={styles.statVal}>{loading ? '—' : stats.events}</div>
          <div className={styles.statSub}>Scheduled ahead</div>
          <div className={styles.statLink} style={{ color: 'var(--text2)' }}>View calendar →</div>
        </div>
      </div>

      <div className={styles.grid}>

        {/* Carousel */}
        <div className={styles.card}>
          <div
            className={styles.cardTitle}
            onClick={() => setScheduleOpen(p => !p)}
            style={{ cursor: 'pointer', justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span className={styles.goldLine} />Coming up
            </span>
            <i className={`ti ti-chevron-${scheduleOpen ? 'up' : 'down'}`} style={{ fontSize: '13px' }} />
          </div>
          {scheduleOpen && (
            <>
              {loading || metricoolPosts.length === 0 ? (
                <div className={styles.empty}>
                  <i className="ti ti-calendar-off" style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text3)' }} />
                  {loading ? 'Loading...' : 'No upcoming posts'}
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  {/* Media */}
                  <div style={{ borderRadius: '8px', overflow: 'hidden', background: 'var(--surface3)', marginBottom: '12px', aspectRatio: currentPost?.instagramData?.type === 'REEL' ? '9/16' : '4/5', maxHeight: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isVideo(currentPost?.media?.[0]) ? (
                      <video
                        key={currentPost.id}
                        src={currentPost.media[0]}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        muted
                        playsInline
                        loop
                        autoPlay
                      />
                    ) : (
                      <img
                        key={currentPost.id}
                        src={currentPost?.media?.[0]}
                        alt="Upcoming post"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    )}
                  </div>

                  {/* Post info */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', color: PLATFORM_COLORS[platforms.split(',')[0].trim()] || 'var(--text3)', textTransform: 'capitalize', fontWeight: '500' }}>
                        {platforms}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text3)' }}>·</span>
                      <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
                        {formatPostDate(currentPost?.publicationDate?.dateTime)}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {currentPost?.text}
                    </div>
                  </div>

                  {/* Navigation */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      onClick={prevPost}
                      disabled={carouselIndex === 0}
                      style={{ background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', color: carouselIndex === 0 ? 'var(--text3)' : 'var(--text)', cursor: carouselIndex === 0 ? 'not-allowed' : 'pointer', fontSize: '13px' }}
                    >
                      <i className="ti ti-chevron-left" />
                    </button>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {metricoolPosts.map((_, i) => (
                        <div
                          key={i}
                          onClick={() => setCarouselIndex(i)}
                          style={{ width: i === carouselIndex ? '16px' : '6px', height: '6px', borderRadius: '3px', background: i === carouselIndex ? 'var(--gold-dim)' : 'var(--border2)', cursor: 'pointer', transition: 'all 0.2s' }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={nextPost}
                      disabled={carouselIndex === metricoolPosts.length - 1}
                      style={{ background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', color: carouselIndex === metricoolPosts.length - 1 ? 'var(--text3)' : 'var(--text)', cursor: carouselIndex === metricoolPosts.length - 1 ? 'not-allowed' : 'pointer', fontSize: '13px' }}
                    >
                      <i className="ti ti-chevron-right" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Content Progress */}
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
              {loading && <div className={styles.empty}>Loading...</div>}
              {!loading && rollingMonths.map(({ month, year }) => {
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
      </div>
    </div>
  )
}
