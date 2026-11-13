// src/components/PostDeliveryBar.jsx
//
// Content Bank, publishing clients. Gathers scheduled posts that are not yet
// in an open delivery and sends them to the client for review. Posts are
// already scheduled (schedule-first), so review never holds up the calendar.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch'

function shortWhen(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '')
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' + m[4] + ':' + m[5]
}

export default function PostDeliveryBar({ client, occurrences, reviewByDraft, onSent }) {
  const navigate = useNavigate()
  const eligible = occurrences
    .filter(o => o.id && o.status === 'scheduled' && o.active !== false && !(reviewByDraft[o.id] && reviewByDraft[o.id].open))
    .sort((a, b) => String(a.publish_date || '').localeCompare(String(b.publish_date || '')))

  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState({})
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (!eligible.length) return null

  function start() {
    const all = {}
    eligible.forEach(o => { all[o.id] = true })
    setPicked(all)
    setError('')
    setOpen(true)
  }

  const chosen = eligible.filter(o => picked[o.id])

  async function send() {
    if (!chosen.length || sending) return
    setSending(true)
    setError('')
    try {
      const res = await apiFetch('/api/delivery', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send', kind: 'posts', clientId: client.id,
          name: name.trim(), dueDate: dueDate || null, note: note.trim(),
          draftIds: chosen.map(o => o.id)
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send.'); setSending(false); return }
      if (client.notification_email) {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({
            type: 'review', posts: true,
            clientName: client.name, month: data.label,
            notificationEmail: client.notification_email,
            note: note.trim() || undefined,
            link: 'https://portal.glowingmoonmedia.com/delivery/' + data.cycleId
          })
        })
      }
      setOpen(false)
      setName(''); setDueDate(''); setNote('')
      setSending(false)
      if (onSent) onSent()
      navigate('/delivery/' + data.cycleId)
    } catch (e) {
      console.error(e)
      setError('Could not send.')
      setSending(false)
    }
  }

  const input = { width: '100%', margin: '4px 0 12px', padding: '9px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text1)', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <button onClick={start} style={{ display: 'flex', alignItems: 'center', gap: '7px', background: 'transparent', border: '1px solid var(--gold-light)', color: 'var(--gold-light)', fontWeight: 600, fontSize: '13px', padding: '9px 16px', borderRadius: '8px', cursor: 'pointer' }}>
          <i className="ti ti-eye-check" aria-hidden="true" />
          Send {eligible.length} scheduled post{eligible.length === 1 ? '' : 's'} for review
        </button>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>Scheduled posts the client has not been sent yet.</span>
      </div>

      {open && (
        <div onClick={() => !sending && setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '22px', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '16px', color: 'var(--text1)', fontWeight: 600, marginBottom: '4px' }}>Send {chosen.length} post{chosen.length === 1 ? '' : 's'} to {client.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
              {client.notification_email ? 'They get an email with a link to review. Anything they do not review publishes as scheduled.' : 'No notification email is set for this client, so no email will go out.'}
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '14px', maxHeight: '220px', overflowY: 'auto' }}>
              {eligible.map(o => (
                <label key={o.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '12px', color: 'var(--text2)' }}>
                  <input type="checkbox" checked={!!picked[o.id]} onChange={e => setPicked(p => ({ ...p, [o.id]: e.target.checked }))} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--text1)' }}>{shortWhen(o.publish_date)}</span> · {(o.platforms || []).join(', ')}
                    <span style={{ display: 'block', color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.caption || o.filename}</span>
                  </span>
                </label>
              ))}
            </div>

            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Name (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Posts, this week" style={input} />
            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Review by (optional)</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={input} />
            <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Note to the client (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} />

            {error && <div style={{ color: 'var(--coral)', fontSize: '12px', marginBottom: '10px' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setOpen(false)} disabled={sending} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: '13px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={send} disabled={sending || !chosen.length} style={{ background: 'var(--teal)', border: 'none', color: '#04211d', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', opacity: sending || !chosen.length ? 0.6 : 1 }}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
