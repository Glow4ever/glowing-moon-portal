import { useState, useEffect } from 'react'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'

const PLATFORM_META = {
  instagram: { label: 'Instagram', icon: 'ti-brand-instagram', color: '#E0729B' },
  linkedin:  { label: 'LinkedIn',  icon: 'ti-brand-linkedin',  color: '#5B9FE8' },
  facebook:  { label: 'Facebook',  icon: 'ti-brand-facebook',  color: '#A8A6A0' },
  tiktok:    { label: 'TikTok',    icon: 'ti-brand-tiktok',    color: '#F4EEE2' },
  twitter:   { label: 'Twitter',   icon: 'ti-brand-x',         color: '#A8A6A0' },
  youtube:   { label: 'YouTube',   icon: 'ti-brand-youtube',   color: '#E8734A' }
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
    const y = (28 - ((v - min) / range) * 25 - 1).toFixed(1)
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
      return { platform, latest, delta, hasHistory: values.length > 1, points: sparklinePoints(values) }
    })
  }

  function latestAggregate(metricType) {
    const row = aggregates.find(a => a.metric_type === metricType)
    return row ? Number(row.value) : null
  }

  // Cadence is per-platform (unlike booking_conversions/link_clicks, which
  // genuinely aren't platform-specific) — pull the most recent row for each
  // platform that has one, rather than a single blended number.
  function cadenceByPlatform() {
    const byPlatform = {}
    aggregates
      .filter(a => a.metric_type === 'cadence' && a.platform)
      .forEach(a => {
        if (!byPlatform[a.platform] || a.period_end > byPlatform[a.platform].period_end) {
          byPlatform[a.platform] = a
        }
      })
    return Object.values(byPlatform).map(a => ({ platform: a.platform, value: Number(a.value) }))
  }

  const audienceByPlatform = platformBreakdown('audience')
  const engagementByPlatform = platformBreakdown('engagement')
  const cadencePlatforms = cadenceByPlatform()
  const bookingConversions = latestAggregate('booking_conversions')
  const linkClicks = latestAggregate('link_clicks')

  const visibleLogEntries = isAdmin ? logEntries : logEntries.filter(e => e.client_visible)

  // Growth-highlight hero — tells the "we're moving the needle" story instead
  // of leaving the client to piece it together from cards. Only claims real
  // growth once there's real history to back it (hasHistory), never
  // fabricates momentum from a single data point.
  const totalAudience = audienceByPlatform.reduce((sum, p) => sum + p.latest, 0)
  const growingPlatforms = audienceByPlatform.filter(p => p.hasHistory && p.delta > 0).sort((a, b) => b.delta - a.delta)
  const bestGrowth = growingPlatforms[0]
  let heroHeadline, heroSub
  if (bestGrowth) {
    const meta = PLATFORM_META[bestGrowth.platform] || { label: bestGrowth.platform }
    heroHeadline = `+${Math.round(bestGrowth.delta)} on ${meta.label} this month`
    heroSub = `${totalAudience} total followers across every connected platform`
  } else if (totalAudience > 0) {
    heroHeadline = `${totalAudience} followers, tracked daily`
    heroSub = 'Trend lines fill in as more days of data come through'
  } else {
    heroHeadline = 'Getting the channel wired up'
    heroSub = 'Real numbers land here as soon as the first few days of data come in'
  }

  if (loading) {
    return <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text3)', fontSize: '16px' }}>Loading metrics...</div>
  }

  return (
    <div style={{ maxWidth: '1320px' }}>
      <style>{`
        @keyframes gmmHeroPulse {
          0%, 100% { box-shadow: 0 0 30px 0 var(--gmm-pulse-color); }
          50%      { box-shadow: 0 0 60px 8px var(--gmm-pulse-color); }
        }
        @keyframes gmmTilePulse {
          0%, 100% { box-shadow: 0 0 0px 0 var(--gmm-tile-pulse); }
          50%      { box-shadow: 0 0 18px 2px var(--gmm-tile-pulse); }
        }
        @keyframes gmmDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>

      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '42px', color: 'var(--text1)', margin: '0 0 6px' }}>Metrics</h1>
      <p style={{ fontSize: '16px', color: 'var(--text3)', marginBottom: '32px' }}>Performance and delivery for {client?.name}</p>

      {/* Growth hero — the "this is working" headline */}
      <div style={{
        background: 'linear-gradient(135deg, var(--surface2), var(--surface1, #17171a))',
        border: `1px solid ${bestGrowth ? 'rgba(29,158,117,0.4)' : 'var(--border)'}`,
        borderRadius: '16px',
        padding: '32px 36px',
        marginBottom: '28px',
        display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
        animation: bestGrowth ? 'gmmHeroPulse 3.2s ease-in-out infinite' : 'none',
        '--gmm-pulse-color': 'rgba(29,158,117,0.28)'
      }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '16px', flexShrink: 0,
          background: bestGrowth ? 'rgba(29,158,117,0.15)' : 'var(--gold-bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <i className={`ti ${bestGrowth ? 'ti-trending-up' : 'ti-activity'}`} style={{ fontSize: '30px', color: bestGrowth ? 'var(--teal)' : 'var(--gold-light)' }} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: '28px', fontWeight: '600', color: 'var(--text1)', marginBottom: '4px' }}>{heroHeadline}</div>
          <div style={{ fontSize: '15px', color: 'var(--text3)' }}>{heroSub}</div>
        </div>
      </div>

      {/* Platform breakdown: audience + engagement, full-width rows */}
      {[
        { key: 'audience', label: 'Audience growth', data: audienceByPlatform },
        { key: 'engagement', label: 'Engagement rate', data: engagementByPlatform }
      ].map(section => (
        <div key={section.key} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '1.75rem', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', background: 'var(--teal)',
                animation: 'gmmDotPulse 2.2s ease-in-out infinite', display: 'inline-block'
              }} />
              <span style={{ fontSize: '16px', color: 'var(--text1)', fontWeight: '500' }}>{section.label}</span>
              <span style={{ fontSize: '13px', color: 'var(--text3)' }}>&middot; by platform</span>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text3)' }}>30 days</span>
          </div>
          {section.data.length === 0 ? (
            <div style={{ fontSize: '14px', color: 'var(--text3)', padding: '8px 0' }}>No data yet</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              {section.data.map(p => {
                const meta = PLATFORM_META[p.platform] || { label: p.platform, icon: 'ti-chart-bar', color: 'var(--text2)' }
                const isGrowing = section.key === 'audience' && p.hasHistory && p.delta > 0
                return (
                  <div
                    key={p.platform}
                    style={{
                      background: 'var(--surface3, #1c1c1f)', borderRadius: '12px', padding: '20px',
                      border: `0.5px solid ${isGrowing ? 'rgba(29,158,117,0.35)' : 'var(--border)'}`,
                      animation: isGrowing ? 'gmmTilePulse 3s ease-in-out infinite' : 'none',
                      '--gmm-tile-pulse': 'rgba(29,158,117,0.45)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <i className={`ti ${meta.icon}`} style={{ fontSize: '18px', color: meta.color }} aria-hidden="true" />
                      <span style={{ fontSize: '14px', color: 'var(--text2)' }}>{meta.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '34px', fontWeight: '600', color: 'var(--text1)' }}>
                        {section.key === 'engagement' ? `${p.latest.toFixed(1)}%` : Math.round(p.latest)}
                      </span>
                      {section.key === 'audience' && p.hasHistory && (
                        <span style={{ fontSize: '14px', color: p.delta >= 0 ? 'var(--teal)' : '#F0997B' }}>
                          {p.delta >= 0 ? `+${Math.round(p.delta)}` : Math.round(p.delta)} / 30d
                        </span>
                      )}
                    </div>
                    <svg viewBox="0 0 100 28" style={{ width: '100%', height: '26px' }} aria-hidden="true">
                      <polyline points={p.points} fill="none" stroke={meta.color} strokeWidth="2.5" />
                    </svg>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}

      {/* Cadence — per-platform, same section style as Audience/Engagement above */}
      <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '1.75rem', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%', background: 'var(--teal)',
              animation: 'gmmDotPulse 2.2s ease-in-out infinite', display: 'inline-block'
            }} />
            <span style={{ fontSize: '16px', color: 'var(--text1)', fontWeight: '500' }}>Cadence adherence</span>
            <span style={{ fontSize: '13px', color: 'var(--text3)' }}>&middot; by platform</span>
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text3)' }}>30 days vs. target</span>
        </div>
        {cadencePlatforms.length === 0 ? (
          <div style={{ fontSize: '14px', color: 'var(--text3)', padding: '8px 0' }}>
            No cadence targets set yet — add weekly targets per platform in Admin to start tracking.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '20px' }}>
            {cadencePlatforms.map(({ platform, value }) => {
              const meta = PLATFORM_META[platform] || { label: platform, icon: 'ti-chart-bar', color: 'var(--text2)' }
              const isOnTarget = value >= 100
              return (
                <div key={platform} style={{ background: 'var(--surface3, #1c1c1f)', borderRadius: '12px', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <i className={`ti ${meta.icon}`} style={{ fontSize: '18px', color: meta.color }} aria-hidden="true" />
                    <span style={{ fontSize: '14px', color: 'var(--text2)' }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: '34px', fontWeight: '600', color: isOnTarget ? 'var(--teal)' : 'var(--text1)' }}>
                    {value}%
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Booking conversions / link clicks — flagship only, genuinely not platform-specific */}
      {isFlagship && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '32px' }}>
          <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '1.75rem' }}>
            <div style={{ fontSize: '14px', color: 'var(--text3)', marginBottom: '10px' }}>Booking conversions</div>
            <div style={{ fontSize: '34px', fontWeight: '600', color: 'var(--text1)' }}>{bookingConversions !== null ? bookingConversions : '—'}</div>
            {bookingConversions === null && <div style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '6px' }}>Not connected yet</div>}
          </div>
          <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '1.75rem' }}>
            <div style={{ fontSize: '14px', color: 'var(--text3)', marginBottom: '10px' }}>Tagged link clicks</div>
            <div style={{ fontSize: '34px', fontWeight: '600', color: 'var(--text1)' }}>{linkClicks !== null ? linkClicks : '—'}</div>
            {linkClicks === null && <div style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '6px' }}>Not connected yet</div>}
          </div>
        </div>
      )}
      {/* Qualitative log — flagship only, per the spec's scope */}
      {isFlagship && (
        <>
          {isAdmin && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '16px', color: 'var(--text1)', marginBottom: '12px' }}>Log a new entry</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={form.entry_type}
                  onChange={e => setForm(p => ({ ...p, entry_type: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '8px', padding: '11px 12px', fontSize: '15px', minWidth: '160px' }}
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
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '8px', padding: '11px 12px', fontSize: '15px', width: '160px', colorScheme: 'dark' }}
                />
                <input
                  type="text"
                  placeholder="Note — e.g. podcast invite from The Recovery Room"
                  value={form.note}
                  onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '8px', padding: '11px 12px', fontSize: '15px', flex: 1, minWidth: '240px' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '14px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={form.client_visible}
                    onChange={e => setForm(p => ({ ...p, client_visible: e.target.checked }))}
                  />
                  Client visible
                </label>
                <button className="btn btn-gold" onClick={addLogEntry} disabled={saving} style={{ fontSize: '15px' }}>
                  <i className="ti ti-plus" aria-hidden="true" /> Add
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: '16px', color: 'var(--text1)', marginBottom: '12px' }}>Log</div>
          <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '6px 22px' }}>
            {visibleLogEntries.length === 0 && (
              <div style={{ padding: '20px 0', fontSize: '14px', color: 'var(--text3)' }}>Nothing logged yet</div>
            )}
            {visibleLogEntries.map((entry, i) => {
              const meta = LOG_TYPE_META[entry.entry_type] || { label: entry.entry_type, bg: 'var(--surface3)', color: 'var(--text3)' }
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 0', borderBottom: i < visibleLogEntries.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text3)', width: '80px', flexShrink: 0 }}>
                    {new Date(entry.entry_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <span style={{ fontSize: '13px', background: meta.bg, color: meta.color, padding: '3px 10px', borderRadius: '20px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {meta.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {entry.title && <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '3px' }}>{entry.title}</div>}
                    <div style={{ fontSize: '15px', color: 'var(--text1)' }}>
                      {entry.note}
                      {entry.link && (
                        <a href={entry.link} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-light)', marginLeft: '8px' }}>
                          <i className="ti ti-external-link" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                      <i
                        className={`ti ${entry.client_visible ? 'ti-eye' : 'ti-eye-off'}`}
                        onClick={() => toggleVisibility(entry)}
                        title={entry.client_visible ? 'Visible to client — click to hide' : 'Internal only — click to show client'}
                        style={{ fontSize: '18px', color: entry.client_visible ? 'var(--text2)' : 'var(--text3)', cursor: 'pointer' }}
                      />
                      <i
                        className="ti ti-trash"
                        onClick={() => deleteEntry(entry)}
                        title="Remove entry"
                        style={{ fontSize: '18px', color: 'var(--text3)', cursor: 'pointer' }}
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
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '8px', padding: '12px 20px', fontSize: '15px', color: 'var(--text1)' }}>
          <i className="ti ti-check" aria-hidden="true" style={{ marginRight: '8px', color: 'var(--teal)' }} /> {toast}
        </div>
      )}
    </div>
  )
}


