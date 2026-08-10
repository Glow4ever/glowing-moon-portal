import { useState, useEffect } from 'react'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'

const PLATFORM_META = {
  instagram: { label: 'Instagram', icon: 'ti-brand-instagram', color: '#D4537E' },
  linkedin:  { label: 'LinkedIn',  icon: 'ti-brand-linkedin',  color: '#378ADD' },
  facebook:  { label: 'Facebook',  icon: 'ti-brand-facebook',  color: '#888780' },
  tiktok:    { label: 'TikTok',    icon: 'ti-brand-tiktok',    color: '#F4EEE2' },
  twitter:   { label: 'Twitter',   icon: 'ti-brand-x',         color: '#888780' },
  youtube:   { label: 'YouTube',   icon: 'ti-brand-youtube',   color: '#D85A30' }
}

const LOG_TYPE_META = {
  press_mention:    { label: 'Press',     bg: 'rgba(127,119,221,0.15)', color: '#AFA9EC' },
  qualitative_win:  { label: 'Win',       bg: 'rgba(29,158,117,0.15)',  color: 'var(--teal)' },
  check_in_note:    { label: 'Check-in',  bg: 'var(--gold-bg)',         color: 'var(--gold-light)' },
  crm_lead_summary: { label: 'CRM',       bg: 'rgba(211,201,167,0.12)', color: 'var(--text2)' }
}

function sparklinePoints(values) {
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = values.length > 1 ? 100 / (values.length - 1) : 0
  return values.map((v, i) => {
    const x = (i * step).toFixed(1)
    const y = (20 - ((v - min) / range) * 18 - 1).toFixed(1)
    return `${x},${y}`
  }).join(' ')
}

export default function Metrics() {
  const { client, role } = useClient()
  const isAdmin = role === 'admin'
  const tier = client?.service_tier || 'pulse'
  const isFlagship = tier === 'flagship'

  const [loading, setLoading] = useState(true)
  const [snapshots, setSnapshots] = useState([])
  const [aggregates, setAggregates] = useState([])
  const [logEntries, setLogEntries] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ entry_type: 'press_mention', entry_date: new Date().toISOString().slice(0, 10), title: '', note: '', link: '', client_visible: true })

  useEffect(() => {
    if (client?.id) loadMetrics()
  }, [client?.id])

  async function loadMetrics() {
    setLoading(true)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const [{ data: snapData }, { data: aggData }, { data: logData }] = await Promise.all([
      supabase.from('metric_snapshots').select('*').eq('client_id', client.id).gte('recorded_date', since).order('recorded_date', { ascending: true }),
      supabase.from('metric_aggregates').select('*').eq('client_id', client.id).order('period_start', { ascending: false }),
      supabase.from('client_log_entries').select('*').eq('client_id', client.id).order('entry_date', { ascending: false })
    ])
    setSnapshots(snapData || [])
    setAggregates(aggData || [])
    setLogEntries(logData || [])
    setLoading(false)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function addLogEntry() {
    if (!form.note.trim()) return showToast('Add a note before saving')
    setSaving(true)
    const { error } = await supabase.from('client_log_entries').insert({
      client_id: client.id,
      entry_type: form.entry_type,
      entry_date: form.entry_date,
      title: form.title.trim() || null,
      note: form.note.trim(),
      link: form.link.trim() || null,
      client_visible: form.client_visible
    })
    if (error) {
      showToast('Could not save entry')
    } else {
      setForm(p => ({ ...p, title: '', note: '', link: '' }))
      await loadMetrics()
      showToast('Logged')
    }
    setSaving(false)
  }

  async function toggleVisibility(entry) {
    await supabase.from('client_log_entries').update({ client_visible: !entry.client_visible }).eq('id', entry.id)
    setLogEntries(prev => prev.map(e => e.id === entry.id ? { ...e, client_visible: !e.client_visible } : e))
  }

  async function deleteEntry(entry) {
    if (!window.confirm('Remove this log entry? This cannot be undone.')) return
    await supabase.from('client_log_entries').delete().eq('id', entry.id)
    setLogEntries(prev => prev.filter(e => e.id !== entry.id))
  }

  // Group audience/engagement snapshots by platform, building a sparkline
  // and a "change over the window" figure for each.
  function platformBreakdown(metricType) {
    const byPlatform = {}
    snapshots.filter(s => s.metric_type === metricType).forEach(s => {
      if (!byPlatform[s.platform]) byPlatform[s.platform] = []
      byPlatform[s.platform].push(s)
    })
    return Object.entries(byPlatform).map(([platform, rows]) => {
      const sorted = rows.sort((a, b) => a.recorded_date.localeCompare(b.recorded_date))
      const values = sorted.map(r => Number(r.value))
      const latest = values[values.length - 1]
      const first = values[0]
      const delta = latest - first
      return { platform, latest, delta, points: sparklinePoints(values) }
    })
  }

  function latestAggregate(metricType) {
    const row = aggregates.find(a => a.metric_type === metricType)
    return row ? Number(row.value) : null
  }

  const audienceByPlatform = platformBreakdown('audience')
  const engagementByPlatform = platformBreakdown('engagement')
  const cadence = latestAggregate('cadence')
  const bookingConversions = latestAggregate('booking_conversions')
  const linkClicks = latestAggregate('link_clicks')

  const visibleLogEntries = isAdmin ? logEntries : logEntries.filter(e => e.client_visible)

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>Loading metrics...</div>
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: 'var(--text1)', margin: 0 }}>Metrics</h1>
        <span style={{ fontSize: '12px', background: 'var(--gold-bg)', color: 'var(--gold-light)', padding: '4px 12px', borderRadius: '20px' }}>
          {isFlagship ? 'Flagship' : 'Pulse'}
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '28px' }}>Performance and delivery for {client?.name}</p>

      {/* Platform breakdown: audience + engagement */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {[
          { key: 'audience', label: 'Audience growth', data: audienceByPlatform },
          { key: 'engagement', label: 'Engagement rate', data: engagementByPlatform }
        ].map(section => (
          <div key={section.key} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text3)' }}>{section.label} &middot; by platform</span>
              <span style={{ fontSize: '11px', color: 'var(--text3)' }}>30 days</span>
            </div>
            {section.data.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text3)' }}>No data yet</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '12px' }}>
                {section.data.map(p => {
                  const meta = PLATFORM_META[p.platform] || { label: p.platform, icon: 'ti-chart-bar', color: 'var(--text2)' }
                  return (
                    <div key={p.platform}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                        <i className={`ti ${meta.icon}`} style={{ fontSize: '13px', color: meta.color }} aria-hidden="true" />
                        <span style={{ fontSize: '11px', color: 'var(--text2)' }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text1)', marginBottom: '3px' }}>
                        {section.key === 'engagement' ? `${p.latest.toFixed(1)}%` : (p.delta >= 0 ? `+${Math.round(p.delta)}` : Math.round(p.delta))}
                      </div>
                      <svg viewBox="0 0 100 20" style={{ width: '100%', height: '16px' }} aria-hidden="true">
                        <polyline points={p.points} fill="none" stroke={meta.color} strokeWidth="2" />
                      </svg>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Aggregate metrics: cadence always, conversions/clicks flagship-only */}
      <div style={{ display: 'grid', gridTemplateColumns: isFlagship ? 'repeat(3, 1fr)' : '1fr', gap: '12px', marginBottom: '28px' }}>
        <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '6px' }}>Cadence adherence</div>
          <div style={{ fontSize: '22px', fontWeight: '500', color: 'var(--text1)' }}>{cadence !== null ? `${cadence}%` : '—'}</div>
          {cadence === null && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>No data logged yet</div>}
        </div>
        {isFlagship && (
          <>
            <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '6px' }}>Booking conversions</div>
              <div style={{ fontSize: '22px', fontWeight: '500', color: 'var(--text1)' }}>{bookingConversions !== null ? bookingConversions : '—'}</div>
              {bookingConversions === null && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>Not connected yet</div>}
            </div>
            <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '6px' }}>Tagged link clicks</div>
              <div style={{ fontSize: '22px', fontWeight: '500', color: 'var(--text1)' }}>{linkClicks !== null ? linkClicks : '—'}</div>
              {linkClicks === null && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>Not connected yet</div>}
            </div>
          </>
        )}
      </div>

      {/* Qualitative log — flagship only, per the spec's scope */}
      {isFlagship && (
        <>
          {isAdmin && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '8px' }}>Log a new entry</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={form.entry_type}
                  onChange={e => setForm(p => ({ ...p, entry_type: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '8px 10px', fontSize: '13px', minWidth: '140px' }}
                >
                  <option value="press_mention">Press mention</option>
                  <option value="qualitative_win">Qualitative win</option>
                  <option value="check_in_note">Check-in note</option>
                  <option value="crm_lead_summary">CRM lead summary</option>
                </select>
                <input
                  type="date"
                  value={form.entry_date}
                  onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '8px 10px', fontSize: '13px', width: '150px', colorScheme: 'dark' }}
                />
                <input
                  type="text"
                  placeholder="Note — e.g. podcast invite from The Recovery Room"
                  value={form.note}
                  onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '8px 10px', fontSize: '13px', flex: 1, minWidth: '220px' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={form.client_visible}
                    onChange={e => setForm(p => ({ ...p, client_visible: e.target.checked }))}
                  />
                  Client visible
                </label>
                <button className="btn btn-gold" onClick={addLogEntry} disabled={saving}>
                  <i className="ti ti-plus" aria-hidden="true" /> Add
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '8px' }}>Log</div>
          <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '4px 16px' }}>
            {visibleLogEntries.length === 0 && (
              <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text3)' }}>Nothing logged yet</div>
            )}
            {visibleLogEntries.map((entry, i) => {
              const meta = LOG_TYPE_META[entry.entry_type] || { label: entry.entry_type, bg: 'var(--surface3)', color: 'var(--text3)' }
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < visibleLogEntries.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text3)', width: '70px', flexShrink: 0 }}>
                    {new Date(entry.entry_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <span style={{ fontSize: '11px', background: meta.bg, color: meta.color, padding: '2px 8px', borderRadius: '20px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {meta.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {entry.title && <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '2px' }}>{entry.title}</div>}
                    <div style={{ fontSize: '13px', color: 'var(--text1)' }}>
                      {entry.note}
                      {entry.link && (
                        <a href={entry.link} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-light)', marginLeft: '6px' }}>
                          <i className="ti ti-external-link" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      <i
                        className={`ti ${entry.client_visible ? 'ti-eye' : 'ti-eye-off'}`}
                        onClick={() => toggleVisibility(entry)}
                        title={entry.client_visible ? 'Visible to client — click to hide' : 'Internal only — click to show client'}
                        style={{ fontSize: '15px', color: entry.client_visible ? 'var(--text2)' : 'var(--text3)', cursor: 'pointer' }}
                      />
                      <i
                        className="ti ti-trash"
                        onClick={() => deleteEntry(entry)}
                        title="Remove entry"
                        style={{ fontSize: '15px', color: 'var(--text3)', cursor: 'pointer' }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', color: 'var(--text1)' }}>
          <i className="ti ti-check" aria-hidden="true" style={{ marginRight: '6px', color: 'var(--teal)' }} /> {toast}
        </div>
      )}
    </div>
  )
}

