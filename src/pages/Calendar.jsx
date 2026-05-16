import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, parseISO } from 'date-fns'
import styles from './Calendar.module.css'

const EVENT_TYPES = [
  { value: 'photo',    label: 'Photo',    color: '#5DCAA5' },
  { value: 'video',    label: 'Video',    color: 'var(--gold-light)' },
  { value: 'deadline', label: 'Deadline', color: '#e0845a' },
  { value: 'social',   label: 'Social',   color: 'var(--text2)' },
]

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 4, 1))
  const [events, setEvents] = useState([])
  const [modal, setModal] = useState(null)
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
  }

  function openNew(date) {
    setForm({ title: '', date: format(date, 'yyyy-MM-dd'), type: 'photo', notes: '' })
    setModal('new')
  }

  function openEdit(ev, e) {
    e.stopPropagation()
    setForm({ ...ev })
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
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div className={styles.legend}>
            {EVENT_TYPES.map(t => (
              <div key={t.value} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: t.color }} />
                {t.label}
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
                {dayEvents.map(ev => (
                  <div
                    key={ev.id}
                    className={`${styles.event} ${styles[ev.type]}`}
                    onClick={e => openEdit(ev, e)}
                    title={ev.title}
                  >
                    {ev.title}
                  </div>
                ))}
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
            return (
              <div key={ev.id} className={styles.upcomingItem} onClick={e => openEdit(ev, e)}>
                <div className={styles.upcomingDate}>
                  {format(parseISO(ev.date), 'MMM').toUpperCase()}
                  <span>{format(parseISO(ev.date), 'd')}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div className={styles.upcomingName}>{ev.title}</div>
                  {ev.notes && <div className={styles.upcomingNotes}>{ev.notes}</div>}
                </div>
                <span className={styles.typeBadge} style={{ background: typeInfo?.color + '22', color: typeInfo?.color }}>
                  {typeInfo?.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

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
              <label className={styles.label}>Notes (optional)</label>
              <input className={styles.input} value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Additional notes" />
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
