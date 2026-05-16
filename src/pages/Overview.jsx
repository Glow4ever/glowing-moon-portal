import { useNavigate } from 'react-router-dom'
import styles from './Overview.module.css'

const stats = [
  { label: 'Total Assets',     value: '142', sub: '+12 this month',  color: 'var(--gold)' },
  { label: 'Content Pieces',   value: '38',  sub: 'Q2 2026',         color: 'var(--teal)' },
  { label: 'Deliveries Due',   value: '3',   sub: 'Next: May 22',    color: 'var(--gold-dim)' },
  { label: 'Awaiting Review',  value: '5',   sub: 'Needs your action', color: 'var(--coral)' },
]

const activity = [
  { icon: 'ti-photo',    bg: 'var(--teal-bg)',              color: 'var(--teal)',       text: <><strong>May Campaign Photos</strong> uploaded — 24 images</>,  time: '2h ago' },
  { icon: 'ti-file',     bg: 'var(--gold-bg)',              color: 'var(--gold-light)', text: <><strong>Brand Guidelines v3</strong> updated in Asset Library</>,time: '1d ago' },
  { icon: 'ti-calendar', bg: 'rgba(255,255,255,0.05)',      color: 'var(--text2)',      text: <><strong>June Content Plan</strong> added to calendar</>,         time: '2d ago' },
  { icon: 'ti-video',    bg: 'var(--coral-bg)',             color: 'var(--coral)',      text: <><strong>Reel edits ×3</strong> ready for review</>,               time: '3d ago' },
]

const quickLinks = [
  { icon: 'ti-palette',  bg: 'var(--gold-bg)',         color: 'var(--gold-light)', title: 'Brand Guidelines',  sub: 'PDF · Updated 1d ago',   to: '/assets' },
  { icon: 'ti-photo',    bg: 'var(--teal-bg)',         color: 'var(--teal)',       title: 'May Photo Assets',  sub: '24 files · Added today', to: '/content' },
  { icon: 'ti-calendar', bg: 'rgba(255,255,255,0.04)', color: 'var(--text2)',      title: 'Content Calendar',  sub: 'Next delivery: May 22',  to: '/calendar' },
]

export default function Overview() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        <div className={styles.bannerContent}>
          <div className={styles.bannerAvatar}>GM</div>
          <div>
            <h2 className={styles.bannerTitle}>Welcome, Glowing Moon Media</h2>
            <p className={styles.bannerSub}>Your portal is current. 3 new assets are ready and your next delivery is scheduled for May 22.</p>
          </div>
        </div>
        <div className={styles.bannerMeta}>
          <div className={styles.bannerDate}>Friday, May 15 · 2026</div>
          <div className={styles.activeBadge}>
            <span className={styles.pulse} /> Active retainer
          </div>
        </div>
      </div>

      <div className={styles.statsGrid}>
        {stats.map(s => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statLabel}>
              <span className={styles.statDot} style={{ background: s.color }} />
              {s.label}
            </div>
            <div className={styles.statVal}>{s.value}</div>
            <div className={styles.statSub}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Recent Activity</div>
          {activity.map((a, i) => (
            <div key={i} className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: a.bg, color: a.color }}>
                <i className={`ti ${a.icon}`} aria-hidden="true" />
              </div>
              <div className={styles.activityText}>{a.text}</div>
              <div className={styles.activityTime}>{a.time}</div>
            </div>
          ))}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}><span className={styles.goldLine} />Quick Access</div>
          {quickLinks.map(l => (
            <div key={l.to} className={styles.quickLink} onClick={() => navigate(l.to)}>
              <div className={styles.quickIcon} style={{ background: l.bg, color: l.color }}>
                <i className={`ti ${l.icon}`} aria-hidden="true" />
              </div>
              <div>
                <div className={styles.quickTitle}>{l.title}</div>
                <div className={styles.quickSub}>{l.sub}</div>
              </div>
              <div className={styles.quickArrow}><i className="ti ti-arrow-right" aria-hidden="true" /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
