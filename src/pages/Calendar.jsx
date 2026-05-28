import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, parseISO } from 'date-fns'
import styles from './Calendar.module.css'

const EVENT_TYPES = [
  { value: 'photo',    label: 'Photo',    color: '#5DCAA5' },
  { value: 'video',    label: 'Video',    color: 'var(--gold-light)' },
  { value: 'deadline', label: 'Deadline', color: '#e0845a' },
  { value: 'social',   label: 'Social',   color: '#7B8CDE' },
]

const PLATFORM_COLORS = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  linkedin: '#0A66C2',
  twitter: '#1DA1F2',
  tiktok: '#010101',
  youtube: '#FF0000',
}

function getPlatformColor(notes) {
  if (!notes) return '#7B8CDE'
  const platform = notes.toLowerCase()
  return PLATFORM_COLORS[platform] || '#7B8CDE'
}

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '...' : str
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 5, 1))
  const [events, setEvents] = useState([])
  const [modal, setModal] = useState(null)
  const [viewEvent, setViewEvent] = useState(null)
  const [form, setForm] = useState({ title: '', date: '', type: 'photo', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    const { data, error } = await supabase.from('calendar_events').select('*').order('date')
    if (!error && data) setEvents(data)
  }

  async function saveEvent() {
    if (!form.title || !form.date) return
    setSaving(true)
    if (modal === 'edit' && form.id) {
      await supabase.from('calendar_events').update({ title: form.title, date: form.date, type: form.type, notes: form.notes }).eq('id', form.id)
    } else {
      await supabase.from('calendar_events').insert({ title: form.title, date: form.date, type: form.type, notes: form.notes })
    }
    await loadEvents()
    setSaving(false)
    setModal(null)
  }

  async function deleteEvent() {
    if (!form.id) return
    await supabase.from('calendar_events').delete().eq('id', form.id)
    await loadEvents()
    setModal(null)
    setViewEvent(null)
  }

  function openNew(date) {
    setForm({ title: '', date: format(date, 'yyyy-MM-dd'), type: 'photo', notes: '' })
    setModal('new')
  }

  function openView(ev, e) {
    e.stopPropagation()
    setViewEvent(ev)
  }

  function openEdit(ev) {
    setForm({ ...ev })
    setViewEvent(null)
    setModal('edit')
  }

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calStart = startOfWeek(monthStart)
  const calEnd = endOfWeek(monthEnd)
  const days = eachDayOfInterval({ start: calStart, end: calEnd })
  const today = new Date()

  function eventsForDay(day) {
    return events.filter(e => e.date === format(day, 'yyyy-MM-dd'))
  }

  function prevMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)) }
  function nextMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)) }

  const upcoming = events
    .filter(e => e.date >= format(today, 'yyyy-MM-dd'))
    .slice(0, 5)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Calendar</h1>
          <p className={styles.sub}>Delivery schedule and content milestones</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className={styles.legend}>
            {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
              <div key={platform} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: color }} />
                {platform.charAt(0).toUpperCase() + platform.slice(1)}
              </div>
            ))}
          </div>
          <button className="btn btn-gold" onClick={() => openNew(today)}>
            <i className="ti ti-plus" aria-hidden="true" /> Add Event
          </button>
        </div>
      </div>

      <div className={styles.calNav}>
        <button className={styles.navBtn} onClick={prevMonth}><i className="ti ti-chevron-left" aria-hidden="true" /></button>
        <div className={styles.calMonth}>{format(currentDate, 'MMMM yyyy')}</div>
        <button className={styles.navBtn} onClick={nextMonth}><i className="ti ti-chevron-right" aria-hidden="true" /></button>
      </div>

      <div className={styles.calGrid}>
        <div className={styles.dayNames}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className={styles.dayName}>{d}</div>
          ))}
        </div>
        <div className={styles.cells}>
          {days.map(day => {
            const isToday = isSameDay(day, today)
            const isCurrentMonth = isSameMonth(day, currentDate)
            const dayEvents = eventsForDay(day)
            return (
              <div
                key={day.toString()}
                className={`${styles.cell} ${!isCurrentMonth ? styles.otherMonth : ''}`}
                onClick={() => openNew(day)}
              >
                <div className={`${styles.cellNum} ${isToday ? styles.today : ''}`}>
                  {format(day, 'd')}
                </div>
                {dayEvents.slice(0, 3).map(ev => (
                  <div
                    key={ev.id}
                    className={styles.eventPill}
                    style={{ background: getPlatformColor(ev.notes) + '22', borderLeft: `3px solid ${getPlatformColor(ev.notes)}` }}
                    onClick={e => openView(ev, e)}
                    title={ev.title}
                  >
                    <span style={{ color: getPlatformColor(ev.notes), fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>
                      {ev.notes?.toLowerCase() || 'post'}
                    </span>
                    <span style={{ color: 'var(--text1)', fontSize: '10px' }}>
                      {truncate(ev.title, 20)}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div style={{ fontSize: '10px', color: 'var(--text3)', padding: '0 4px' }}>
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className={styles.upcomingCard}>
          <div className={styles.upcomingTitle}>Upcoming</div>
          {upcoming.map(ev => {
            const typeInfo = EVENT_TYPES.find(t => t.value === ev.type)
            const platformColor = getPlatformColor(ev.notes)
            return (
              <div key={ev.id} className={styles.upcomingItem} onClick={e => openView(ev, e)}>
                <div className={styles.upcomingDate}>
                  {format(parseISO(ev.date), 'MMM').toUpperCase()}
                  <span>{format(parseISO(ev.date), 'd')}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div className={styles.upcomingName}>{truncate(ev.title, 60)}</div>
                  {ev.notes && (
                    <div style={{ fontSize: '11px', color: platformColor, marginTop: '2px', textTransform: 'capitalize' }}>
                      {ev.notes}
                    </div>
                  )}
                </div>
                <span className={styles.typeBadge} style={{ background: platformColor + '22', color: platformColor }}>
                  {ev.notes || typeInfo?.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* View Event Modal */}
      {viewEvent && (
        <div className={styles.overlay} onClick={() => setViewEvent(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: getPlatformColor(viewEvent.notes) + '22',
                  color: getPlatformColor(viewEvent.notes),
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize'
                }}>
                  {viewEvent.notes || 'Post'}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text3)' }}>
                  {format(parseISO(viewEvent.date), 'MMMM d, yyyy')}
                </span>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '16px' }}
                onClick={() => setViewEvent(null)}
              >
                <i className="ti ti-x" />
              </button>
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text1)', lineHeight: '1.6', marginBottom: '20px' }}>
              {viewEvent.title}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => setViewEvent(null)}>Close</button>
              <button className="btn btn-gold" onClick={() => openEdit(viewEvent)}>
                <i className="ti ti-pencil" /> Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>{modal === 'edit' ? 'Edit Event' : 'New Event'}</div>
            <div className={styles.field}>
              <label className={styles.label}>Title</label>
              <input className={styles.input} value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="Event title" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Date</label>
              <input type="date" className={styles.input} value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Type</label>
              <select className={styles.input} value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Platform</label>
              <select className={styles.input} value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))}>
                <option value="">Select platform</option>
                {Object.keys(PLATFORM_COLORS).map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className={styles.modalActions}>
              {modal === 'edit' && (
                <button className="btn btn-danger" onClick={deleteEvent}>
                  <i className="ti ti-trash" aria-hidden="true" /> Delete
                </button>
              )}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={saveEvent} disabled={saving}>
                {saving ? 'Saving...' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
