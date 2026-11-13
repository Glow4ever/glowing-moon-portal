// src/pages/Delivery.jsx
//
// One delivery built from the content bank. Two kinds:
//   files  (delivery clients)   the client approves assets and downloads them
//   posts  (publishing clients) the client reviews posts that are already
//                               scheduled; anything not reviewed publishes on time
// Clients review here; the team follows along, replies, and sends things back.
// Reads go to Supabase (RLS) plus /api/delivery 'details' for post content.
// Every change goes through /api/delivery.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch'
import { getPreviewLink, getDownloadLink, getFileType } from '../lib/dropbox'
import styles from './Admin.module.css'

const PLATFORM_NAMES = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
  tiktok: 'TikTok', youtube: 'YouTube', twitter: 'X', threads: 'Threads', pinterest: 'Pinterest'
}
const platformName = p => PLATFORM_NAMES[p] || p

const TZ_SHORT = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Los_Angeles': 'PT' }

// publish_date is stored as wall-clock time in the post's own timezone, so it
// is formatted as written, never converted.
function whenLabel(post) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(post.publish_date || '')
  if (!m) return 'No date set'
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  let h = +m[4]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  const tz = TZ_SHORT[post.timezone] || post.timezone || ''
  return `${day}, ${h}:${m[5]} ${ampm}${tz ? ' ' + tz : ''}`
}

function captionFor(post, platform) {
  const own = post.platform_captions && post.platform_captions[platform]
  return own !== undefined && own !== null ? own : (post.caption || '')
}

export default function Delivery() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { role, client: activeClient, switchClient } = useClient()
  const isTeam = role === 'admin' || role === 'editor'
  const isViewer = role === 'viewer'

  const [cycle, setCycle] = useState(null)
  const [owner, setOwner] = useState(null) // the client row
  const [items, setItems] = useState([])
  const [posts, setPosts] = useState({}) // schedule_draft_id -> post details
  const [comments, setComments] = useState([])
  const [previews, setPreviews] = useState({}) // item id -> url
  const [captionTab, setCaptionTab] = useState({}) // item id -> platform
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [commentFor, setCommentFor] = useState(null)
  const [commentText, setCommentText] = useState('')

  const load = useCallback(async () => {
    const { data: cy } = await supabase.from('review_cycles').select('*').eq('id', id).maybeSingle()
    if (!cy || cy.source !== 'bank') { setNotFound(true); setLoading(false); return }
    const [{ data: its }, { data: cms }, { data: cl }] = await Promise.all([
      supabase.from('review_cycle_items').select('*').eq('cycle_id', id).order('position'),
      supabase.from('file_comments').select('*').eq('cycle_id', id).order('created_at'),
      supabase.from('clients').select('id, name, notification_email').eq('id', cy.client_id).maybeSingle()
    ])
    if ((its || []).some(i => i.schedule_draft_id)) {
      try {
        const res = await apiFetch('/api/delivery', { method: 'POST', body: JSON.stringify({ action: 'details', cycleId: id }) })
        const json = await res.json()
        if (res.ok) setPosts(json.posts || {})
      } catch (e) { console.error('Delivery details error:', e) }
    }
    setCycle(cy)
    setItems(its || [])
    setComments(cms || [])
    setOwner(cl || null)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // A team member who opens a link from an email lands on the delivery's own client.
  useEffect(() => {
    if (isTeam && owner && activeClient?.id !== owner.id && switchClient) switchClient(owner.id)
  }, [isTeam, owner, activeClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pageLink = 'https://portal.glowingmoonmedia.com/delivery/' + id

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
      setBusy(false)
      if (!res.ok) { setError(data.error || 'That did not work.'); return null }
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
          body: JSON.stringify({ type: 'approved', clientName: owner.name, month: cycle.folder_label, link: pageLink })
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
            body: JSON.stringify({ type: 'comment_reply', notificationEmail: owner.notification_email, fileName: item.filename, comment: text, link: pageLink })
          })
        }
      } else {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({
            type: 'comment',
            clientName: owner?.name,
            fileName: item.filename + (data.published ? ' (already published)' : ''),
            comment: text,
            link: pageLink
          })
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
            link: pageLink
          })
        })
      }
    } catch (e) { console.error('Revised email error:', e) }
    await load()
  }

  async function closeDelivery() {
    if (!window.confirm('Close this delivery now? Anything not approved stays unapproved.')) return
    if (await call({ action: 'resolve' })) await load()
  }

  async function cancelDelivery() {
    if (!window.confirm('Delete this delivery? The client will no longer see it. Scheduled posts stay scheduled.')) return
    if (await call({ action: 'cancel' })) navigate('/content-bank')
  }

  async function download(item) {
    const url = await getDownloadLink(item.dropbox_path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (loading) return <div className={styles.page}><div className={styles.empty}>Loading...</div></div>
  if (notFound || !cycle) return <div className={styles.page}><div className={styles.empty}>This delivery was not found.</div></div>

  const isPosts = items.some(i => i.schedule_draft_id)
  const postOf = item => (item.schedule_draft_id ? posts[item.schedule_draft_id] : null)
  const liveStatus = item => {
    const p = postOf(item)
    if (!item.schedule_draft_id) return null
    if (!p) return 'gone'
    if (p.status === 'published') return 'published'
    if (p.status === 'cancelled') return 'pulled'
    return null
  }
  const isDone = item => item.review_status === 'approved' || !!liveStatus(item)
  const approvedCount = items.filter(i => i.review_status === 'approved').length
  const liveCount = items.filter(i => liveStatus(i) === 'published').length
  const total = items.length
  const closed = !!cycle.resolved_at
  const remaining = items.filter(i => !isDone(i))
  // The note written when the delivery was sent is the only comment with no item.
  const teamNote = comments.find(c => !c.item_id && c.sender_role === 'admin')
  const itemComments = itemId => comments.filter(c => c.item_id === itemId)

  const btn = (extra) => ({
    background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
    fontSize: '12px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', ...extra
  })

  function statusLine(item) {
    const live = liveStatus(item)
    if (live === 'published') return { text: 'Published', color: 'var(--teal)' }
    if (live === 'pulled') return { text: 'Removed from the schedule', color: 'var(--text3)' }
    if (live === 'gone') return { text: 'No longer scheduled', color: 'var(--text3)' }
    if (item.review_status === 'approved') return { text: 'Approved', color: 'var(--teal)' }
    if (item.review_status === 'changes_requested') return { text: 'Change requested', color: 'var(--coral)' }
    return { text: isPosts ? 'Scheduled, waiting for review' : 'Waiting for approval', color: 'var(--gold-light)' }
  }

  return (
    <div className={styles.page}>
      <button onClick={() => navigate(isTeam ? '/content-bank' : '/')} style={{ ...btn(), border: 'none', padding: 0, marginBottom: '14px' }}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Back
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', color: 'var(--text1)' }}>{cycle.folder_label}</h1>
        <span style={{ fontSize: '13px', color: closed ? 'var(--teal)' : cycle.stage === 'revisions' ? 'var(--coral)' : 'var(--gold-light)' }}>
          {closed ? (isPosts ? 'Done' : 'All approved') : cycle.stage === 'revisions' ? 'Changes requested' : 'In review'}
        </span>
        {isTeam && owner && <span style={{ fontSize: '13px', color: 'var(--text3)' }}>{owner.name}</span>}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '18px' }}>
        {approvedCount} of {total} approved{liveCount ? ` · ${liveCount} published` : ''}
        {cycle.due_date ? ` · Review by ${new Date(cycle.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
      </div>

      {isPosts && !closed && (
        <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.5 }}>
          These posts are already scheduled. Approve them, or request a change before they go out. Anything not reviewed publishes as scheduled.
        </div>
      )}

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
            {remaining.length === total ? `Approve all ${total}` : `Approve the remaining ${remaining.length}`}
          </button>
        )}
        {isTeam && !closed && <button onClick={closeDelivery} disabled={busy} style={btn()}>Close delivery</button>}
        {isTeam && <button onClick={cancelDelivery} disabled={busy} style={btn({ color: 'var(--coral)' })}>Delete delivery</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isPosts ? 300 : 260}px, 1fr))`, gap: '16px' }}>
        {items.map(item => {
          const post = postOf(item)
          const live = liveStatus(item)
          const done = isDone(item)
          const type = getFileType(item.filename)
          const url = previews[item.id]
          const notes = itemComments(item.id)
          const st = statusLine(item)
          const platforms = (post && post.platforms) || []
          const tab = captionTab[item.id] || platforms[0]
          const captionsDiffer = post && platforms.some(p => captionFor(post, p) !== captionFor(post, platforms[0]))
          return (
            <div key={item.id} style={{ background: 'var(--surface2)', border: '1px solid ' + (item.review_status === 'approved' ? 'var(--teal)' : item.review_status === 'changes_requested' && !done ? 'var(--coral)' : 'var(--border)'), borderRadius: '12px', overflow: 'hidden', opacity: live === 'pulled' || live === 'gone' ? 0.6 : 1 }}>
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
                {post ? (
                  <>
                    <div style={{ fontSize: '13px', color: 'var(--text1)', fontWeight: 500, marginBottom: '4px' }}>{whenLabel(post)}</div>
                    {/* One row of platforms. When captions differ by platform, each one
                        is also a tab that shows that platform's caption. */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {platforms.map(p => {
                        const on = captionsDiffer && tab === p
                        const label = platformName(p) + (p === 'instagram' && post.ig_post_type && post.ig_post_type !== 'POST' ? ` ${post.ig_post_type.toLowerCase()}` : '')
                        return captionsDiffer ? (
                          <button key={p} onClick={() => setCaptionTab(t => ({ ...t, [item.id]: p }))}
                            style={{ fontSize: '11px', cursor: 'pointer', background: 'transparent', borderRadius: '999px', padding: '2px 8px', color: on ? 'var(--gold-light)' : 'var(--text2)', border: '1px solid ' + (on ? 'var(--gold-light)' : 'var(--border)') }}>
                            {label}
                          </button>
                        ) : (
                          <span key={p} style={{ fontSize: '11px', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '999px', padding: '2px 8px' }}>{label}</span>
                        )
                      })}
                    </div>
                    {captionsDiffer && (
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '4px' }}>Caption for {platformName(tab)}. Tap a platform to see its caption.</div>
                    )}
                    <div style={{ fontSize: '13px', color: 'var(--text1)', whiteSpace: 'pre-wrap', lineHeight: 1.5, background: 'var(--surface)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                      {captionFor(post, captionsDiffer ? tab : platforms[0]) || <span style={{ color: 'var(--text3)' }}>No caption</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '4px', wordBreak: 'break-word' }}>{item.filename}</div>
                  </>
                ) : (
                  <div style={{ fontSize: '13px', color: 'var(--text1)', marginBottom: '4px', wordBreak: 'break-word' }}>{item.filename}</div>
                )}
                <div style={{ fontSize: '12px', color: st.color, marginBottom: '10px' }}>{st.text}</div>

                {notes.map(n => (
                  <div key={n.id} style={{ fontSize: '12px', marginBottom: '6px', color: n.resolved ? 'var(--text3)' : 'var(--text1)' }}>
                    <span style={{ color: 'var(--text3)' }}>{n.sender_role === 'admin' ? 'Team' : 'Client'}: </span>{n.comment}
                  </div>
                ))}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {!done && !isViewer && !closed && (
                    <button onClick={() => approve([item.id])} disabled={busy} style={btn({ color: 'var(--teal)', borderColor: 'var(--teal)' })}>Approve</button>
                  )}
                  {live !== 'pulled' && live !== 'gone' && (
                    <button onClick={() => { setCommentFor(commentFor === item.id ? null : item.id); setCommentText('') }} style={btn()}>
                      {isTeam ? 'Reply' : live === 'published' ? 'Leave a note' : 'Request a change'}
                    </button>
                  )}
                  {isTeam && !post && !closed && (item.review_status !== 'awaiting') && (
                    <button onClick={() => reopen(item)} disabled={busy} style={btn()}>Send revised file</button>
                  )}
                  {isTeam && post && !live && (
                    <button onClick={() => navigate('/content-bank')} style={btn()}>Edit in Content Bank</button>
                  )}
                  {!post && item.review_status === 'approved' && <button onClick={() => download(item)} style={btn()}>Download</button>}
                </div>

                {commentFor === item.id && (
                  <div style={{ marginTop: '10px' }}>
                    {!isTeam && live === 'published' && (
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '6px' }}>This post is already live. Your note goes to the team.</div>
                    )}
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
