import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import styles from './Overview.module.css'

async function listDropboxFolder(path) {
  const res = await fetch('/api/dropbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'files/list_folder',
      body: { path, include_deleted: false }
    })
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

export default function Overview() {
  const navigate = useNavigate()
  const { client } = useClient()
  const [stats, setStats] = useState({ assets: 0, content: 0, events: 0 })
  const [recentFiles, setRecentFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [contentMonths, setContentMonths] = useState([])
  const [monthUploads, setMonthUploads] = useState({})
  const [monthScheduled, setMonthScheduled] = useState({})

  useEffect(() => { loadDashboard() }, [client])

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

    const recentContent = await listDropboxFolder(`${basePath}/Content`)
    const recentAssets = await listDropboxFolder(`${basePath}/Assets`)
    const allRecent = [...recentContent, ...recentAssets]
      .filter(e => e['.tag'] === 'file')
      .sort((a, b) => new Date(b.server_modified) - new Date(a.server_modified))
      .slice(0, 4)

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
      const endDate = new Date(year, MONTH_NAMES.indexOf(month) + 1, 0)
        .toISOString().split('T')[0]

      const { count: sched } = await supabase
        .from('calendar_events')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('date', startDate)
        .lte('date', endDate)

      scheduledMap[key] = sched || 0
    }))

    setStats({ assets: assetCount, content: contentCount, events: count || 0 })
    setRecentFiles(allRecent)
    setContentMonths(monthRows || [])
    setMonthUploads(uploadsMap)
    setMonthScheduled(scheduledMap)
    setLoading(false)
  }

  function timeAgo(str) {
    if (!str) return ''
    const diff = Date.now() - new Date(str).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
  const rollingMonths = getRollingMonths()

  return (
    <div className={styles.page}>
      <div className={styles.banner} style={client?.cover_url ? {
        backgroundImage: `linear-gradient(to right, var(--surface2) 30%, transparent 100%), url(${client.cover_url})`,
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
            <p className={styles.bannerSub}>{loading ? 'Loading your portal...' : `You have ${stats.assets} assets, ${stats.content} content files, and ${stats.events} upcoming calendar events.`}</p>
          </div>
        </div>
        <div className={styles.bannerMeta}>
          <div className={styles.bannerDate} style={{ color: '#ffffff' }}>{today}</div>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--gold)' }} />Total Assets</div>
          <div className={styles.statVal}>{loading ? '—' : stats.assets}</div>
          <div className={styles.statSub}>Across all folders</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--teal)' }} />Content Files</div>
          <div className={styles.statVal}>{loading ? '—' : stats.content}</div>
          <div className={styles.statSub}>Photos & videos</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--gold-dim)' }} />Upcoming Events</div>
          <div className={styles.statVal}>{loading ? '—' : stats.events}</div>
          <div className={styles.statSub}>On the calendar</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--coral)' }} />Total Files</div>
          <div className={styles.statVal}>{loading ? '—' : stats.assets + stats.content}</div>
          <div className={styles.statSub}>Assets + content</div>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Recent Uploads</div>
          {loading && <div className={styles.empty}>Loading...</div>}
          {!loading && recentFiles.length === 0 && (
            <div className={styles.empty}>
              <i className="ti ti-upload" style={{ fontSize:'24px', marginBottom:'8px', color:'var(--text3)' }} />
              No files uploaded yet.
            </div>
          )}
          {recentFiles.map((f, i) => (
            <div key={i} className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background:'var(--gold-bg)', color:'var(--gold-light)' }}>
                <i className="ti ti-file" />
              </div>
              <div className={styles.activityText}>
                <strong>{f.name}</strong>
                <div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>{f.path_display?.split('/').slice(-2, -1)[0] || ''}</div>
              </div>
              <div className={styles.activityTime}>{timeAgo(f.server_modified)}</div>
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Content Progress</div>
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
              <div key={key} style={{
                padding: '12px 0',
                borderBottom: '1px solid var(--border)'
              }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:'var(--gold-dim)', flexShrink:0 }} />
                    <span style={{ fontSize:'13px', fontWeight:'500', color:'var(--text)' }}>{key}</span>
                  </div>
                  <span style={{
                    fontSize:'11px', padding:'2px 9px', borderRadius:'20px',
                    background: status.bg, color: status.color,
                    border: `1px solid ${status.border}`
                  }}>{status.label}</span>
                </div>
                <div style={{ display:'flex', gap:'20px', marginBottom:'10px' }}>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'18px', fontWeight:'500', color:'var(--text)', fontFamily:"'Cormorant Garamond', serif" }}>{planned}</div>
                    <div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>Planned</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'18px', fontWeight:'500', color:'var(--text)', fontFamily:"'Cormorant Garamond', serif" }}>{uploaded}</div>
                    <div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>Uploaded</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'18px', fontWeight:'500', color:'var(--text)', fontFamily:"'Cormorant Garamond', serif" }}>{approved}</div>
                    <div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>Approved</div>
                  </div>
                  {hasScheduled && (
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:'18px', fontWeight:'500', color:'var(--text)', fontFamily:"'Cormorant Garamond', serif" }}>{scheduled}</div>
                      <div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>Scheduled</div>
                    </div>
                  )}
                </div>
                <div style={{ height:'3px', background:'var(--border)', borderRadius:'99px' }}>
                  <div style={{ width:`${progress}%`, height:'3px', background:'var(--gold-dim)', borderRadius:'99px', transition:'width 0.4s ease' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
