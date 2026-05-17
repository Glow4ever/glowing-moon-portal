import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import styles from './Overview.module.css'

export default function Overview() {
const navigate = useNavigate()
const { client } = useClient()
  const [stats, setStats] = useState({ assets: 0, content: 0, events: 0 })
  const [recentFiles, setRecentFiles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    let assetCount = 0
    const assetFolders = ['brand-guidelines','canva-templates','planning-docs','design-assets','reports']
    for (const folder of assetFolders) {
      const { data } = await supabase.storage.from('portal-assets').list(`assets/${folder}`)
      if (data) assetCount += data.filter(f => f.name !== '.keep').length
    }
    let contentCount = 0
    const { data: contentFolders } = await supabase.storage.from('portal-assets').list('content')
    if (contentFolders) {
      for (const folder of contentFolders) {
        const { data } = await supabase.storage.from('portal-assets').list(`content/${folder.name}`)
        if (data) contentCount += data.filter(f => f.name !== '.keep').length
      }
    }
    const today = new Date().toISOString().split('T')[0]
    const { count } = await supabase.from('calendar_events').select('*', { count: 'exact', head: true }).gte('date', today)
    const recent = []
    for (const folder of assetFolders) {
      const { data } = await supabase.storage.from('portal-assets').list(`assets/${folder}`, { sortBy: { column: 'created_at', order: 'desc' }, limit: 2 })
      if (data) data.filter(f => f.name !== '.keep').forEach(f => recent.push({ ...f, folder }))
    }
    recent.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setStats({ assets: assetCount, content: contentCount, events: count || 0 })
    setRecentFiles(recent.slice(0, 4))
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

  function folderLabel(id) {
    const map = { 'brand-guidelines':'Brand Guidelines','canva-templates':'Canva Templates','planning-docs':'Planning Docs','design-assets':'Design Assets','reports':'Reports & Analytics' }
    return map[id] || id
  }

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        <div className={styles.bannerContent}>
          <div className={styles.bannerAvatar}>GM</div>
          <div>
           <h2 className={styles.bannerTitle}>Welcome, {client?.name || 'Glowing Moon Media'}</h2>
            <p className={styles.bannerSub}>{loading ? 'Loading your portal...' : `You have ${stats.assets} assets, ${stats.content} content files, and ${stats.events} upcoming calendar events.`}</p>
          </div>
        </div>
        <div className={styles.bannerMeta}>
          <div className={styles.bannerDate}>{today}</div>
          <div className={styles.activeBadge}><span className={styles.pulse} /> Active</div>
        </div>
      </div>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}><div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--gold)' }} />Total Assets</div><div className={styles.statVal}>{loading ? '—' : stats.assets}</div><div className={styles.statSub}>Across all folders</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--teal)' }} />Content Files</div><div className={styles.statVal}>{loading ? '—' : stats.content}</div><div className={styles.statSub}>Photos & videos</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--gold-dim)' }} />Upcoming Events</div><div className={styles.statVal}>{loading ? '—' : stats.events}</div><div className={styles.statSub}>On the calendar</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}><span className={styles.statDot} style={{ background:'var(--coral)' }} />Total Files</div><div className={styles.statVal}>{loading ? '—' : stats.assets + stats.content}</div><div className={styles.statSub}>Assets + content</div></div>
      </div>
      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Recent Uploads</div>
          {loading && <div className={styles.empty}>Loading...</div>}
          {!loading && recentFiles.length === 0 && <div className={styles.empty}><i className="ti ti-upload" style={{ fontSize:'24px', marginBottom:'8px', color:'var(--text3)' }} />No files uploaded yet. Head to the Asset Library to get started.</div>}
          {recentFiles.map((f, i) => (
            <div key={i} className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background:'var(--gold-bg)', color:'var(--gold-light)' }}><i className="ti ti-file" /></div>
              <div className={styles.activityText}><strong>{f.name}</strong><div style={{ fontSize:'10px', color:'var(--text3)', marginTop:'1px' }}>{folderLabel(f.folder)}</div></div>
              <div className={styles.activityTime}>{timeAgo(f.created_at)}</div>
            </div>
          ))}
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Quick Access</div>
          <div className={styles.quickLink} onClick={() => navigate('/assets')}><div className={styles.quickIcon} style={{ background:'var(--gold-bg)', color:'var(--gold-light)' }}><i className="ti ti-folder" /></div><div><div className={styles.quickTitle}>Asset Library</div><div className={styles.quickSub}>Brand files, templates & docs</div></div><div className={styles.quickArrow}><i className="ti ti-arrow-right" /></div></div>
          <div className={styles.quickLink} onClick={() => navigate('/content')}><div className={styles.quickIcon} style={{ background:'var(--teal-bg)', color:'var(--teal)' }}><i className="ti ti-photo" /></div><div><div className={styles.quickTitle}>Content Library</div><div className={styles.quickSub}>Photos & videos</div></div><div className={styles.quickArrow}><i className="ti ti-arrow-right" /></div></div>
          <div className={styles.quickLink} onClick={() => navigate('/calendar')}><div className={styles.quickIcon} style={{ background:'rgba(255,255,255,0.04)', color:'var(--text2)' }}><i className="ti ti-calendar" /></div><div><div className={styles.quickTitle}>Content Calendar</div><div className={styles.quickSub}>{stats.events} upcoming events</div></div><div className={styles.quickArrow}><i className="ti ti-arrow-right" /></div></div>
        </div>
      </div>
    </div>
  )
}
