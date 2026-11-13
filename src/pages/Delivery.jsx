// src/pages/Delivery.jsx
//
// One delivery built from the content bank. Clients review and approve
// here; the team can follow it, send a revised file back, or close it.
// Reads go straight to Supabase (RLS); every change goes through /api/delivery.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch'
import { getPreviewLink, getDownloadLink, getFileType } from '../lib/dropbox'
import styles from './Admin.module.css'

export default function Delivery() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { role } = useClient()
  const isTeam = role === 'admin' || role === 'editor'
  const isViewer = role === 'viewer'

  const [cycle, setCycle] = useState(null)
  const [owner, setOwner] = useState(null) // the client row
  const [items, setItems] = useState([])
  const [approved, setApproved] = useState({}) // dropbox_path -> true
  const [comments, setComments] = useState([])
  const [previews, setPreviews] = useState({}) // item id -> url
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [commentFor, setCommentFor] = useState(null)
  const [commentText, setCommentText] = useState('')

  const load = useCallback(async () => {
    const { data: cy } = await supabase.from('review_cycles').select('*').eq('id', id).maybeSingle()
    if (!cy || cy.source !== 'bank') { setNotFound(true); setLoading(false); return }
    const [{ data: its }, { data: sts }, { data: cms }, { data: cl }] = await Promise.all([
      supabase.from('review_cycle_items').select('*').eq('cycle_id', id).order('position'),
      supabase.from('file_status').select('file_path, status').eq('cycle_id', id),
      supabase.from('file_comments').select('*').eq('cycle_id', id).order('created_at'),
      supabase.from('clients').select('id, name, notification_email').eq('id', cy.client_id).maybeSingle()
    ])
    setCycle(cy)
    setItems(its || [])
    const ap = {}
    ;(sts || []).forEach(s => { if (s.status === 'approved') ap[s.file_path] = true })
    setApproved(ap)
    setComments(cms || [])
    setOwner(cl || null)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // Previews load in the background, a few at a time.
  useEffect(() => {
    let cancelled = false
    async function run() {
      const media = items.filter(i => ['photo', 'video'].includes(getFileType(i.filename)) && !previews[i.id])
      for (let n = 0; n < media.length; n += 6) {
        await Promise.all(media.slice(n, n + 6).map(async it => {
          const url = await getPreviewLink(it.dropbox_path)
          if (url && !cancelled) setPreviews(p => ({ ...p, [it.id]: url }))
        }))
      }
    }
    if (items.length) run()
    return () => { cancelled = true }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  async function call(payload) {
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/delivery', { method: 'POST', body: JSON.stringify({ cycleId: id, ...payload }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'That did not work.'); setBusy(false); return null }
      setBusy(false)
      return data
    } catch (e) {
      console.error(e)
      setError('That did not work.')
      setBusy(false)
      return null
    }
  }

  async function approve(itemIds) {
    const data = await call({ action: 'approve', itemIds })
    if (!data) return
    if (data.closed && owner) {
      try {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({ type: 'approved', clientName: owner.name, month: cycle.folder_label })
        })
        await supabase.from('notifications').insert({
          client_id: owner.id,
          type: 'approval',
          message: `${owner.name} approved ${cycle.folder_label}`
        })
      } catch (e) { console.error('Approval side effects error:', e) }
    }
    await load()
  }

  async function submitComment(item) {
    const text = commentText.trim()
    if (!text) return
    const data = await call({ action: 'comment', itemId: item.id, comment: text })
    if (!data) return
    try {
      if (isTeam) {
        if (owner?.notification_email) {
          await apiFetch('/api/send-email', {
            method: 'POST',
            body: JSON.stringify({ type: 'comment_reply', notificationEmail: owner.notification_email, fileName: item.filename, comment: text })
          })
        }
      } else {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({ type: 'comment', clientName: owner?.name, fileName: item.filename, comment: text })
        })
      }
    } catch (e) { console.error('Comment email error:', e) }
    setCommentText('')
    setCommentFor(null)
    await load()
  }

  async function reopen(item) {
    const data = await call({ action: 'reopen', itemId: item.id })
    if (!data) return
    try {
      if (owner?.notification_email) {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({
            type: 'file_revised',
            clientName: owner.name,
            month: cycle.folder_label,
            fileName: item.filename,
            notificationEmail: owner.notification_email,
            link: 'https://portal.glowingmoonmedia.com/delivery/' + id
          })
        })
      }
    } catch (e) { console.error('Revised email error:', e) }
    await load()
  }

  async function closeDelivery() {
    if (!window.confirm('Close this delivery now? Files that are not approved stay unapproved.')) return
    if (await call({ action: 'resolve' })) await load()
  }

  async function cancelDelivery() {
    if (!window.confirm('Delete this delivery? The client will no longer see it.')) return
    if (await call({ action: 'cancel' })) navigate('/content-bank')
  }

  async function download(item) {
    const url = await getDownloadLink(item.dropbox_path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (loading) return <div className={styles.page}><div className={styles.empty}>Loading...</div></div>
  if (notFound || !cycle) return <div className={styles.page}><div className={styles.empty}>This delivery was not found.</div></div>

  const total = items.length
  const doneCount = items.filter(i => approved[i.dropbox_path]).length
  const closed = !!cycle.resolved_at
  const remaining = items.filter(i => !approved[i.dropbox_path])
  const teamNote = comments.find(c => !c.item_id && c.sender_role === 'admin')
  const itemComments = id2 => comments.filter(c => c.item_id === id2)

  const btn = (extra) => ({
    background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
    fontSize: '12px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', ...extra
  })

  return (
    <div className={styles.page}>
      <button onClick={() => navigate(isTeam ? '/content-bank' : '/')} style={{ ...btn(), border: 'none', padding: 0, marginBottom: '14px' }}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Back
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', color: 'var(--text1)' }}>{cycle.folder_label}</h1>
        <span style={{ fontSize: '13px', color: closed ? 'var(--teal)' : cycle.stage === 'revisions' ? 'var(--coral)' : 'var(--gold-light)' }}>
          {closed ? 'All approved' : cycle.stage === 'revisions' ? 'Revisions asked' : 'In review'}
        </span>
        {isTeam && owner && <span style={{ fontSize: '13px', color: 'var(--text3)' }}>{owner.name}</span>}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '18px' }}>
        {doneCount} of {total} approved
        {cycle.due_date ? ` · Review by ${new Date(cycle.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
      </div>

      {teamNote && (
        <div style={{ background: 'var(--surface2)', borderLeft: '3px solid var(--gold-light)', borderRadius: '6px', padding: '12px 14px', marginBottom: '18px', fontSize: '14px', color: 'var(--text1)' }}>
          {teamNote.comment}
        </div>
      )}

      {error && <div style={{ color: 'var(--coral)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '22px' }}>
        {!isViewer && !closed && remaining.length > 0 && (
          <button
            onClick={() => approve(remaining.map(i => i.id))}
            disabled={busy}
            style={{ background: 'var(--teal)', border: 'none', color: '#04211d', fontWeight: 600, fontSize: '13px', padding: '9px 16px', borderRadius: '8px', cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
          >
            {doneCount === 0 ? `Approve all ${total}` : `Approve the remaining ${remaining.length}`}
          </button>
        )}
        {isTeam && !closed && <button onClick={closeDelivery} disabled={busy} style={btn()}>Close delivery</button>}
        {isTeam && <button onClick={cancelDelivery} disabled={busy} style={btn({ color: 'var(--coral)' })}>Delete delivery</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
        {items.map(item => {
          const ok = !!approved[item.dropbox_path]
          const type = getFileType(item.filename)
          const url = previews[item.id]
          const notes = itemComments(item.id)
          const needsRevision = notes.some(n => n.sender_role === 'member' && !n.resolved)
          return (
            <div key={item.id} style={{ background: 'var(--surface2)', border: '1px solid ' + (ok ? 'var(--teal)' : 'var(--border)'), borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ background: 'var(--surface)', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {url && type === 'photo' ? (
                  <img src={url} alt={item.filename} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : url && type === 'video' ? (
                  <video src={url} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <i className={'ti ' + (type === 'video' ? 'ti-video' : type === 'photo' ? 'ti-photo' : 'ti-file')} style={{ fontSize: '34px', color: 'var(--text3)' }} aria-hidden="true" />
                )}
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text1)', marginBottom: '4px', wordBreak: 'break-word' }}>{item.filename}</div>
                <div style={{ fontSize: '12px', color: ok ? 'var(--teal)' : 'var(--gold-light)', marginBottom: '10px' }}>{ok ? 'Approved' : 'Waiting for approval'}</div>

                {notes.map(n => (
                  <div key={n.id} style={{ fontSize: '12px', marginBottom: '6px', color: n.resolved ? 'var(--text3)' : 'var(--text1)' }}>
                    <span style={{ color: 'var(--text3)' }}>{n.sender_role === 'admin' ? 'Team' : 'Client'}: </span>{n.comment}
                  </div>
                ))}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {!ok && !isViewer && !closed && (
                    <button onClick={() => approve([item.id])} disabled={busy} style={btn({ color: 'var(--teal)', borderColor: 'var(--teal)' })}>Approve</button>
                  )}
                  {!closed && <button onClick={() => { setCommentFor(commentFor === item.id ? null : item.id); setCommentText('') }} style={btn()}>{isTeam ? 'Reply' : 'Request a change'}</button>}
                  {isTeam && (ok || needsRevision) && !closed && <button onClick={() => reopen(item)} disabled={busy} style={btn()}>Send revised file</button>}
                  {ok && <button onClick={() => download(item)} style={btn()}>Download</button>}
                </div>

                {commentFor === item.id && (
                  <div style={{ marginTop: '10px' }}>
                    <textarea
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      rows={3}
                      placeholder={isTeam ? 'Reply to the client' : 'What should change?'}
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text1)', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                    <button onClick={() => submitComment(item)} disabled={busy || !commentText.trim()} style={btn({ marginTop: '6px', color: 'var(--gold-light)', borderColor: 'var(--gold-light)' })}>Send</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
