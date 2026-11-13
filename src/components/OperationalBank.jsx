// src/components/OperationalBank.jsx
//
// The Content Bank for operational clients (delivery_mode = 'operational').
// Pick files, see which are unused / in review / delivered, and send the
// picked set to the client as one delivery. Publishing clients keep the
// caption and scheduling composer; this replaces it only for operational ones.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch'
import { getFileType, formatBytes } from '../lib/dropbox'

const STATE_META = {
  unused: { label: 'Unused', color: 'var(--text3)' },
  in_review: { label: 'In review', color: 'var(--gold-light)' },
  delivered: { label: 'Delivered', color: 'var(--teal)' }
}

export default function OperationalBank({ client, fileEntries, thumbs }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [openDeliveries, setOpenDeliveries] = useState([])
  const [selected, setSelected] = useState({}) // path_lower -> file entry
  const [filter, setFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!client?.id) return
    const [{ data: itemRows }, { data: cycleRows }] = await Promise.all([
      supabase
        .from('review_cycle_items')
        .select('id, dropbox_path, created_at, cycle_id, review_cycles(id, resolved_at)')
        .eq('client_id', client.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('review_cycles')
        .select('id, folder_label, sent_at, due_date, stage, planned_count')
        .eq('client_id', client.id)
        .eq('source', 'bank')
        .is('resolved_at', null)
        .order('sent_at', { ascending: false })
    ])
    setItems(itemRows || [])
    setOpenDeliveries(cycleRows || [])
  }, [client?.id])

  useEffect(() => { load() }, [load])

  // Latest delivery wins: a file sent twice shows the state of its newest delivery.
  const stateByPath = useMemo(() => {
    const out = {}
    items.forEach(it => {
      if (out[it.dropbox_path]) return // rows are newest first
      const closed = it.review_cycles && it.review_cycles.resolved_at
      out[it.dropbox_path] = closed ? 'delivered' : 'in_review'
    })
    return out
  }, [items])

  const stateOf = f => stateByPath[f.path_lower] || 'unused'
  const visible = fileEntries.filter(f => filter === 'all' || stateOf(f) === filter)
  const picked = Object.values(selected)

  function toggle(f) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[f.path_lower]) delete next[f.path_lower]
      else next[f.path_lower] = f
      return next
    })
  }

  async function send() {
    if (!picked.length || sending) return
    setSending(true)
    setError('')
    try {
      const res = await apiFetch('/api/delivery', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send',
          clientId: client.id,
          name: name.trim(),
          dueDate: dueDate || null,
          note: note.trim(),
          files: picked.map(f => ({ path: f.path_lower, name: f.name }))
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not send the delivery.')
        setSending(false)
        return
      }
      if (client.notification_email) {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({
            type: 'review',
            clientName: client.name,
            month: data.label,
            notificationEmail: client.notification_email,
            note: note.trim() || undefined,
            link: 'https://portal.glowingmoonmedia.com/delivery/' + data.cycleId
          })
        })
      }
      setSelected({})
      setName(''); setDueDate(''); setNote('')
      setModalOpen(false)
      await load()
      navigate('/delivery/' + data.cycleId)
    } catch (e) {
      console.error(e)
      setError('Could not send the delivery.')
    }
    setSending(false)
  }

  const pill = (key, label) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      style={{
        background: filter === key ? 'var(--surface2)' : 'transparent',
        border: '1px solid ' + (filter === key ? 'var(--gold-light)' : 'var(--border)'),
        color: filter === key ? 'var(--gold-light)' : 'var(--text2)',
        fontSize: '12px', padding: '5px 12px', borderRadius: '999px', cursor: 'pointer'
      }}
    >{label}</button>
  )

  return (
    <div>
      {openDeliveries.length > 0 && (
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Open deliveries</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {openDeliveries.map(d => (
              <button
                key={d.id}
                onClick={() => navigate('/delivery/' + d.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', cursor: 'pointer', textAlign: 'left', color: 'var(--text1)', fontSize: '13px' }}
              >
                <span style={{ fontWeight: 500 }}>{d.folder_label}</span>
                <span style={{ color: 'var(--text3)', fontSize: '12px' }}>{d.planned_count} files</span>
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: d.stage === 'revisions' ? 'var(--coral)' : 'var(--gold-light)' }}>
                  {d.stage === 'revisions' ? 'Revisions asked' : 'In review'}
                </span>
                <i className="ti ti-arrow-right" style={{ color: 'var(--text3)' }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {pill('all', 'All')}
        {pill('unused', 'Unused')}
        {pill('in_review', 'In review')}
        {pill('delivered', 'Delivered')}
      </div>

      {visible.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: '13px', padding: '24px 0' }}>No files in this view.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', paddingBottom: picked.length ? '90px' : 0 }}>
          {visible.map(f => {
            const st = stateOf(f)
            const on = !!selected[f.path_lower]
            const thumb = thumbs[f.path_lower]
            const type = getFileType(f.name)
            return (
              <div
                key={f.path_lower}
                onClick={() => toggle(f)}
                style={{
                  background: 'var(--surface2)', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer',
                  border: '2px solid ' + (on ? 'var(--teal)' : 'var(--border)'), position: 'relative'
                }}
              >
                <div style={{ aspectRatio: '1 / 1', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {thumb && type === 'photo' ? (
                    <img src={thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : thumb && type === 'video' ? (
                    <video src={thumb} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <i className={'ti ' + (type === 'video' ? 'ti-video' : type === 'photo' ? 'ti-photo' : 'ti-file')} style={{ fontSize: '28px', color: 'var(--text3)' }} aria-hidden="true" />
                  )}
                </div>
                <div style={{ position: 'absolute', top: '8px', left: '8px', width: '22px', height: '22px', borderRadius: '6px', background: on ? 'var(--teal)' : 'rgba(0,0,0,0.55)', border: '1px solid ' + (on ? 'var(--teal)' : 'rgba(255,255,255,0.4)'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#04211d', fontSize: '14px' }}>
                  {on && <i className="ti ti-check" aria-hidden="true" />}
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.name}>{f.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '11px' }}>
                    <span style={{ color: STATE_META[st].color }}>{STATE_META[st].label}</span>
                    {f.size ? <span style={{ color: 'var(--text3)' }}>{formatBytes(f.size)}</span> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {picked.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, display: 'flex', justifyContent: 'center', padding: '14px', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', background: 'var(--surface)', border: '1px solid var(--teal)', borderRadius: '12px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
            <span style={{ fontSize: '13px', color: 'var(--text1)' }}>This delivery ({picked.length} item{picked.length === 1 ? '' : 's'})</span>
            <button onClick={() => setSelected({})} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
            <button onClick={() => { setError(''); setModalOpen(true) }} style={{ background: 'var(--teal)', border: 'none', color: '#04211d', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>
              Send for review
            </button>
          </div>
        </div>
      )}

      {modalOpen && (
        <div onClick={() => !sending && setModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '22px', width: '100%', maxWidth: '420px' }}>
            <div style={{ fontSize: '16px', color: 'var(--text1)', fontWeight: 600, marginBottom: '4px' }}>Send {picked.length} file{picked.length === 1 ? '' : 's'} to {client.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px' }}>
              {client.notification_email ? 'They get an email with a link to review.' : 'No notification email is set for this client, so no email will go out.'}
            </div>

            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Name (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Delivery, this week"
              style={{ width: '100%', margin: '4px 0 12px', padding: '9px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text1)', fontSize: '13px', boxSizing: 'border-box' }} />

            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Review by (optional)</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              style={{ width: '100%', margin: '4px 0 12px', padding: '9px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text1)', fontSize: '13px', boxSizing: 'border-box' }} />

            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Note to the client (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              style={{ width: '100%', margin: '4px 0 12px', padding: '9px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text1)', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }} />

            {error && <div style={{ color: 'var(--coral)', fontSize: '12px', marginBottom: '10px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setModalOpen(false)} disabled={sending} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: '13px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={send} disabled={sending} style={{ background: 'var(--teal)', border: 'none', color: '#04211d', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', opacity: sending ? 0.7 : 1 }}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
