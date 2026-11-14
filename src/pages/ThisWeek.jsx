import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { apiFetch } from '../lib/apiFetch'
import styles from './Admin.module.css'

// Team home. Shows exactly what the Monday email shows, live. Both read the
// same source (api/_weekitems.js), so they cannot disagree.
export default function ThisWeek() {
  const { switchClient, allClients } = useClient()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const res = await apiFetch('/api/week-plan')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load this week')
      setData(json)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function markCallBooked(row) {
    if (!window.confirm(`Mark ${row.name}'s quarterly call as booked? The reminder clears until next quarter.`)) return
    const res = await apiFetch('/api/week-plan', {
      method: 'POST',
      body: JSON.stringify({ action: 'mark_call_booked', clientId: row.clientId }),
    })
    if (res.ok) {
      flash(`${row.name}: quarterly call marked booked`)
      load()
    } else {
      flash('Could not mark the call booked')
    }
  }

  function openFor(row, path) {
    switchClient(row.clientId)
    navigate(path)
  }

  const swatch = id => allClients.find(c => c.id === id)?.primary_color || '#D3C9A7'
  // The signed-in person's own clients first, then everyone else's.
  const rows = [...(data?.rows || [])].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0))
  const active = rows.filter(r => r.status === 'active')
  const due = active.filter(r => r.items.length > 0)
  const quiet = active.filter(r => r.items.length === 0)
  const onboarding = rows.filter(r => r.status !== 'active')

  const smallBtn = { fontSize: '12px', padding: '5px 12px' }
  // Your own clients' posts first.
  const flags = [...(data?.postFlags || [])].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0))
  function whenText(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '')
    if (!m) return v
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
    return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) + ' ' + h + ':' + m[5] + ' ' + ap
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>This Week</h1>
        <p className={styles.sub}>{data ? `Week of ${data.weekOfLabel}. The Monday email says the same thing.` : 'Loading...'}</p>
      </div>

      {error && <div className={styles.empty}>{error}</div>}
      {data && rows.length === 0 && (
        <div className={styles.empty}>No clients yet.</div>
      )}

      {(data?.bankPrompts || []).length > 0 && (
        <>
          <div className={styles.sectionLabel}>New quarter, content bank not set</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '22px' }}>
            {[...data.bankPrompts].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0)).map(b => (
              <div key={b.clientId} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text1)', minWidth: '120px' }}>{b.clientName}</span>
                <span style={{ color: 'var(--text2)' }}>Q{b.quarter} has started. Set this quarter's bank folder.</span>
                <button className={styles.editBtn} style={{ marginLeft: 'auto' }} onClick={() => { switchClient(b.clientId); navigate('/content-bank') }}>
                  Open Content Bank
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {flags.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Going out in the next 48 hours, not approved</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '22px' }}>
            {flags.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text1)', minWidth: '120px' }}>{f.clientName}</span>
                <span style={{ color: 'var(--text2)' }}>{whenText(f.when)}</span>
                <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>{f.filename}</span>
                <span style={{ color: f.kind === 'change' ? 'var(--coral)' : 'var(--gold-light)' }}>
                  {f.kind === 'change' ? 'Change requested' : 'Not reviewed'}
                </span>
                <button className={styles.editBtn} style={{ marginLeft: 'auto' }} onClick={() => { switchClient(f.clientId); navigate('/delivery/' + f.cycleId) }}>
                  Open delivery
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {due.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Due this week</div>
          <div className={styles.clientGrid}>
            {due.map(row => (
              <div key={row.clientId} className={styles.clientCard}>
                <div className={styles.clientCardMain}>
                  <div className={styles.clientSwatch} style={{ background: swatch(row.clientId) }} />
                  <div className={styles.clientInfo}>
                    <div className={styles.clientName}>{row.name}</div>
                    <div className={styles.clientSlug}>{row.chip}</div>
                    <div className={styles.clientSlug}>{row.mine ? 'Yours' : row.ownerEmail ? `Managed by ${row.ownerEmail}` : 'Not assigned'}</div>
                  </div>
                </div>
                <div style={{ marginTop: '10px' }}>
                  {row.items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', color: item.done ? 'var(--teal)' : 'var(--text)' }}>
                        {item.done ? '✓' : '○'}&nbsp; {item.text}{item.done ? ' (sent)' : ''}
                      </span>
                      {item.kind === 'review' && !item.done && (
                        <button className={styles.editBtn} onClick={() => openFor(row, '/content-bank')}>
                          Open Content Bank
                        </button>
                      )}
                      {item.kind === 'report' && item.draftReady && (
                        <button className="btn btn-gold" style={smallBtn} onClick={() => navigate('/reports')}>
                          Open report draft
                        </button>
                      )}
                      {item.kind === 'call' && (
                        <button className="btn btn-gold" style={smallBtn} onClick={() => markCallBooked(row)}>
                          Mark call booked
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {quiet.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Nothing due</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>
            {quiet.map(r => `${r.name} (${r.chip})`).join(', ')}
          </div>
        </>
      )}

      {onboarding.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Onboarding</div>
          <div style={{ fontSize: '13px', color: 'var(--gold-light)', marginBottom: '20px', lineHeight: 1.8 }}>
            {onboarding.map(r => (
              <div key={r.clientId}>
                {r.name}: {r.status === 'upcoming' ? `delivery starts ${r.startsOnLabel}` : 'delivery week 1 not set'}
              </div>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: 'var(--surface3)', border: '1px solid var(--border2)', color: 'var(--text)', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', zIndex: 1000 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
