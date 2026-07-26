import { logAction } from '../lib/audit'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useClient } from '../lib/ClientContext'
import { reconcileClientCounts } from '../lib/fileCounts'
import styles from './Admin.module.css'
import { apiFetch } from '../lib/apiFetch'

export default function Admin() {
  const { allClients, updateClientBranding, loadUserContext, switchClient } = useClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('clients')
  const [teamMembers, setTeamMembers] = useState([])
  const [trackerRollup, setTrackerRollup] = useState({})
  const [attentionQueue, setAttentionQueue] = useState([])
  const [activityFeed, setActivityFeed] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', primary_color: '#D3C9A7', secondary_color: '#2B2B2E' })
  const [newMember, setNewMember] = useState({ email: '', password: '', client_id: '', role: 'member' })
  const [editingClient, setEditingClient] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [auditLogs, setAuditLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [resyncing, setResyncing] = useState({})
  const [trackerOpen, setTrackerOpen] = useState(null)
  const [settingStatus, setSettingStatus] = useState(false)
  const didResetBrand = useRef(false)

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, b => chars[b % chars.length]).join('')
  }

  useEffect(() => { loadTeam(); loadTrackerRollup(); loadAttentionQueue(); loadActivityFeed() }, [])

  // Reset the active-client branding to GMM whenever the Admin panel mounts,
  // so opening a client folder themes to them but returning here is neutral.
  useEffect(() => {
    if (didResetBrand.current || !allClients?.length) return
    const gmm = allClients.find(c => c.slug === 'glowing-moon-media')
    if (gmm) { switchClient(gmm.id); didResetBrand.current = true }
  }, [allClients])

  async function loadTeam() {
    const { data } = await supabase
      .from('user_roles')
      .select('*, clients(name)')
      .order('created_at')
    if (data) setTeamMembers(data)
  }

  async function loadTrackerRollup() {
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('client_id, status'),
      supabase.from('file_comments').select('client_id, file_path')
    ])

    const rollup = {}

    ;(statusRows || []).forEach(r => {
      if (!rollup[r.client_id]) rollup[r.client_id] = { approved: 0, in_review: 0, revision: 0 }
      if (r.status === 'approved') rollup[r.client_id].approved++
      else rollup[r.client_id].in_review++
    })

    // revision overrides in_review — count unique file paths with comments
    const revisionByClient = {}
    ;(commentRows || []).forEach(r => {
      if (!revisionByClient[r.client_id]) revisionByClient[r.client_id] = new Set()
      revisionByClient[r.client_id].add(r.file_path)
    })
    Object.entries(revisionByClient).forEach(([clientId, paths]) => {
      if (!rollup[clientId]) rollup[clientId] = { approved: 0, in_review: 0, revision: 0 }
      rollup[clientId].revision = paths.size
      // Those revision files were counted as in_review — subtract them
      rollup[clientId].in_review = Math.max(0, rollup[clientId].in_review - paths.size)
    })

    setTrackerRollup(rollup)
  }

  async function loadAttentionQueue() {
    const WAITING_THRESHOLD_DAYS = 3

    const [{ data: pendingClients }, { data: commentRows }] = await Promise.all([
      supabase.from('clients').select('id, name, approval_status, approval_sent_at').eq('approval_status', 'pending'),
      supabase.from('file_comments').select('client_id, file_path, sender_role, created_at').order('created_at', { ascending: true })
    ])

    const items = []

    // Waiting on client — review sent, no response in N+ days
    ;(pendingClients || []).forEach(c => {
      if (!c.approval_sent_at) return
      const days = Math.floor((Date.now() - new Date(c.approval_sent_at).getTime()) / (1000 * 60 * 60 * 24))
      if (days >= WAITING_THRESHOLD_DAYS) {
        items.push({ type: 'waiting_client', clientId: c.id, clientName: c.name, days })
      }
    })

    // Waiting on admin — client's revision note is the latest message in its thread, no reply yet
    const lastMessageByThread = {}
    ;(commentRows || []).forEach(r => {
      lastMessageByThread[`${r.client_id}::${r.file_path}`] = r
    })
    const waitingOnAdminByClient = {}
    Object.values(lastMessageByThread).forEach(r => {
      if (r.sender_role !== 'admin') {
        waitingOnAdminByClient[r.client_id] = (waitingOnAdminByClient[r.client_id] || 0) + 1
      }
    })
    Object.entries(waitingOnAdminByClient).forEach(([clientId, count]) => {
      const c = allClients.find(cl => cl.id === clientId)
      items.push({ type: 'waiting_admin', clientId, clientName: c?.name || 'A client', count })
    })

    setAttentionQueue(items)
  }

  async function loadActivityFeed() {
    setActivityLoading(true)

    function relativeTime(dateStr) {
      const diffMs = Date.now() - new Date(dateStr).getTime()
      const mins = Math.floor(diffMs / 60000)
      if (mins < 1) return 'just now'
      if (mins < 60) return `${mins} min ago`
      const hours = Math.floor(mins / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      if (days === 1) return 'Yesterday'
      return `${days} days ago`
    }

    const [{ data: uploadLogs }, { data: approvedRows }, { data: commentRows }, { data: sentClients }] = await Promise.all([
      supabase.from('audit_logs').select('client_id, user_email, details, created_at').eq('action', 'upload').order('created_at', { ascending: false }).limit(20),
      supabase.from('file_status').select('client_id, updated_at').eq('status', 'approved').order('updated_at', { ascending: false }).limit(50),
      supabase.from('file_comments').select('client_id, file_path, sender_role, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('id, name, approval_sent_at, approval_month').not('approval_sent_at', 'is', null)
    ])

    const clientName = (id) => allClients.find(c => c.id === id)?.name || 'A client'
    const events = []

    ;(uploadLogs || []).forEach(l => {
      events.push({
        color: 'var(--text3)',
        title: `${l.details?.count || ''} file${l.details?.count !== 1 ? 's' : ''} uploaded${l.details?.folder ? ` to ${l.details.folder}` : ''}`,
        subtitle: clientName(l.client_id),
        time: l.created_at
      })
    })

    // Group approvals by client + same calendar day
    const approvalGroups = {}
    ;(approvedRows || []).forEach(r => {
      const day = r.updated_at.slice(0, 10)
      const key = `${r.client_id}::${day}`
      if (!approvalGroups[key]) approvalGroups[key] = { client_id: r.client_id, count: 0, latest: r.updated_at }
      approvalGroups[key].count++
      if (r.updated_at > approvalGroups[key].latest) approvalGroups[key].latest = r.updated_at
    })
    Object.values(approvalGroups).forEach(g => {
      events.push({
        color: 'var(--teal)',
        title: `${g.count} file${g.count !== 1 ? 's' : ''} approved`,
        subtitle: clientName(g.client_id),
        time: g.latest
      })
    })

    ;(commentRows || []).forEach(r => {
      const fileName = r.file_path.split('/').pop()
      events.push({
        color: '#F0997B',
        title: r.sender_role === 'admin' ? `You replied on ${fileName}` : `Revision note on ${fileName}`,
        subtitle: r.sender_role === 'admin' ? clientName(r.client_id) : `${clientName(r.client_id)} · awaiting your reply`,
        time: r.created_at
      })
    })

    ;(sentClients || []).forEach(c => {
      events.push({
        color: 'var(--gold-light)',
        title: `${c.approval_month || 'Content'} sent for review`,
        subtitle: c.name,
        time: c.approval_sent_at
      })
    })

    events.sort((a, b) => new Date(b.time) - new Date(a.time))
    setActivityFeed(events.slice(0, 15).map(e => ({ ...e, relativeTime: relativeTime(e.time) })))
    setActivityLoading(false)
  }

  async function removeTeamMember(member) {
    if (member.role === 'admin') return showToast('Cannot remove admin accounts from here')
    const confirmed = window.confirm(`Remove portal access for ${member.email || 'this user'}? This deletes their login entirely — they'll need to be re-invited to regain access.`)
    if (!confirmed) return
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: member.user_id }
    })
    if (error || data?.error) {
      let message = 'Failed to remove user.'
      try {
        const body = await error?.context?.json()
        if (body?.error) message = body.error
      } catch {}
      if (data?.error) message = data.error
      showToast(message)
      return
    }
    await supabase.from('user_roles').delete().eq('id', member.id)
    await loadTeam()
    showToast('Portal access removed')
  }

  async function loadAuditLogs() {
    setLoadingLogs(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (data) setAuditLogs(data)
    setLoadingLogs(false)
  }

  async function loadComments() {
    setLoadingComments(true)
    const { data } = await supabase
      .from('file_comments')
      .select('*, clients(name, primary_color)')
      .order('created_at', { ascending: false })
    if (data) setComments(data)
    setLoadingComments(false)
  }

  async function dismissComment(id) {
    await supabase.from('file_comments').delete().eq('id', id)
    setComments(prev => prev.filter(c => c.id !== id))
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function resyncFiles(client) {
    setResyncing(p => ({ ...p, [client.id]: true }))
    const { assetCount, contentCount } = await reconcileClientCounts(client.id, client.name)
    await loadUserContext()
    showToast(`${client.name} resynced — ${assetCount} assets, ${contentCount} content files`)
    setResyncing(p => ({ ...p, [client.id]: false }))
  }

  async function onboardClient() {
    if (!newClient.name.trim()) return
    setSaving(true)
    const slug = newClient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const { data: clientData, error: clientError } = await supabase.from('clients').insert({
      name: newClient.name.trim(),
      slug,
      primary_color: newClient.primary_color,
      secondary_color: newClient.secondary_color,
      active: true
    }).select().single()
    if (clientError) {
      showToast('Failed to create client.')
      setSaving(false)
      return
    }
    if (newMember.email) {
      const password = newMember.password || generatePassword()
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: newMember.email,
          password,
          client_id: clientData.id,
          role: 'member'
        }
      })
      if (error || data?.error) {
        let message = 'Client created but user account failed. Add manually.'
        try {
          const body = await error?.context?.json()
          if (body?.error) message = `Client created, but: ${body.error}`
        } catch {}
        if (data?.error) message = `Client created, but: ${data.error}`
        showToast(message)
        setSaving(false)
        return
      }
      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'welcome',
          clientName: newClient.name.trim(),
          recipientEmail: newMember.email
        })
      })
    }
    setNewClient({ name: '', primary_color: '#D3C9A7', secondary_color: '#2B2B2E' })
    setNewMember({ email: '', password: '', client_id: '', role: 'member' })
    await loadUserContext()
    await loadTeam()
    showToast('Client onboarded!')
    setSaving(false)
  }

  async function saveClientBranding() {
    if (!editingClient) return
    setSaving(true)
    await updateClientBranding(editingClient.id, {
      name: editingClient.name,
      primary_color: editingClient.primary_color,
      secondary_color: editingClient.secondary_color,
      notification_email: editingClient.notification_email || null,
      cover_url: editingClient.cover_url || null,
    })
    setEditingClient(null)
    showToast('Branding saved!')
    setSaving(false)
  }

  function deriveStage(client) {
    const roll = trackerRollup[client.id]
    const hasFiles = !!roll
    const hasRevisions = (roll?.revision || 0) > 0
    if (client.approval_status === 'approved') return 'approved'
    if (hasRevisions) return 'revisions'
    if (client.approval_status === 'pending') return 'in_review'
    return hasFiles ? 'uploaded' : 'none'
  }

  async function setClientStatus(client, target) {
    const roll = trackerRollup[client.id] || { approved: 0, in_review: 0, revision: 0 }
    let message = ''
    if (target === 'none') {
      message = `Reset ${client.name} to neutral? This clears the review status and removes all file approvals and revision notes for this client.`
    } else if (target === 'approved') {
      message = `Mark ${client.name} as fully approved? This approves all ${roll.in_review + roll.revision} outstanding file${roll.in_review + roll.revision !== 1 ? 's' : ''} and clears any revision notes.`
    } else if (target === 'pending') {
      message = `Set ${client.name} back to in review? Files stay as they are — the client will see the review banner again.`
    } else if (target === 'revision') {
      message = `Flag ${client.name} as needing revisions?`
    }
    if (!window.confirm(message)) return

    setSettingStatus(true)
    try {
      if (target === 'none') {
        await supabase.from('file_status').delete().eq('client_id', client.id)
        await supabase.from('file_comments').delete().eq('client_id', client.id)
        await supabase.from('clients').update({
          approval_status: null, approval_month: null, approval_folder_path: null, approval_sent_at: null, approval_due_date: null
        }).eq('id', client.id)
      } else if (target === 'approved') {
        await supabase.from('file_comments').delete().eq('client_id', client.id)
        await supabase.from('file_status').update({ status: 'approved' }).eq('client_id', client.id)
        await supabase.from('clients').update({ approval_status: 'approved' }).eq('id', client.id)
      } else {
        await supabase.from('clients').update({ approval_status: target }).eq('id', client.id)
      }
      await loadUserContext()
      await loadTrackerRollup()
      showToast(`${client.name} status updated`)
    } catch (err) {
      console.error('setClientStatus error:', err)
      showToast('Could not update status')
    }
    setSettingStatus(false)
  }

  async function clearReview(client) {
    const confirmed = window.confirm(`Clear the pending review for ${client.name}? This will remove the "Pending Review" status and the client's Next Steps banner.`)
    if (!confirmed) return
    await supabase.from('clients').update({
      approval_status: null,
      approval_month: null,
      approval_folder_path: null,
      approval_sent_at: null,
      approval_due_date: null
    }).eq('id', client.id)
    await loadUserContext()
    showToast(`Review cleared for ${client.name}`)
  }

  function getStatusBadge(status, client) {
    if (!status || status === 'none') return null
    const map = {
      pending: { bg: 'var(--gold-bg)', color: 'var(--gold-light)', label: 'Pending Review ×' },
      approved: { bg: 'var(--teal-bg)', color: 'var(--teal)', label: 'Approved' },
      revision: { bg: '#2a1a1a', color: '#ff6b6b', label: 'Revision Requested' }
    }
    const s = map[status]
    if (!s) return null
    if (status === 'pending' && client) {
      return (
        <span
          className={styles.teamBadge}
          onClick={() => clearReview(client)}
          style={{ background: s.bg, color: s.color, cursor: 'pointer' }}
          title="Click to clear pending review"
        >
          {s.label}
        </span>
      )
    }
    return <span className={styles.teamBadge} style={{ background: s.bg, color: s.color }}>{s.label}</span>
  }

  const commentsByClient = comments.reduce((acc, c) => {
    const name = c.clients?.name || 'Unknown'
    if (!acc[name]) acc[name] = { color: c.clients?.primary_color, items: [] }
    acc[name].items.push(c)
    return acc
  }, {})

  return (
    <div className={styles.page}>
      <style>{`
        @keyframes gmmStageSweep {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes gmmStagePulse {
          0%, 100% { box-shadow: 0 0 4px 0 var(--gmm-pulse); }
          50%      { box-shadow: 0 0 11px 1px var(--gmm-pulse); }
        }
      `}</style>

      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <p className={styles.sub}>Manage clients, branding, and team access</p>
      </div>

      <div className={styles.tabs}>
        {['clients','team','revisions','audit'].map(t => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => {
              setTab(t)
              if (t === 'audit') loadAuditLogs()
              if (t === 'revisions') loadComments()
            }}
          >
            {t === 'clients' ? 'Clients' : t === 'team' ? 'Team Members' : t === 'revisions' ? 'Revisions' : 'Audit Log'}
          </button>
        ))}
      </div>

      {tab === 'clients' && (
        <>
          {attentionQueue.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <i className="ti ti-alert-circle" style={{ fontSize: '15px', color: 'var(--gold-light)' }} />
                <div className={styles.sectionLabel} style={{ marginBottom: 0 }}>Needs attention</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                {attentionQueue.map((item, i) => {
                  if (item.type === 'waiting_client') {
                    return (
                      <div key={i} style={{ background: 'var(--gold-bg)', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 0 16px 0 rgba(211,201,167,0.18)', border: '1px solid rgba(211,201,167,0.3)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--gold-light)', marginBottom: '4px' }}>Waiting on client</div>
                        <div style={{ fontSize: '13px', color: 'var(--text1)', lineHeight: '1.5' }}>
                          {item.clientName} hasn't responded in {item.days} day{item.days !== 1 ? 's' : ''}
                        </div>
                        <button
                          onClick={() => showToast('Nudge is coming soon')}
                          style={{ marginTop: '10px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Send nudge
                        </button>
                      </div>
                    )
                  }
                  if (item.type === 'waiting_admin') {
                    return (
                      <div key={i} style={{ background: '#2a1a1a', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 0 16px 0 rgba(240,153,123,0.15)', border: '1px solid rgba(240,153,123,0.3)' }}>
                        <div style={{ fontSize: '11px', color: '#F0997B', marginBottom: '4px' }}>Waiting on admin</div>
                        <div style={{ fontSize: '13px', color: 'var(--text1)', lineHeight: '1.5' }}>
                          {item.count} revision note{item.count !== 1 ? 's' : ''} unanswered for {item.clientName}
                        </div>
                        <button
                          onClick={() => setTrackerOpen(item.clientId)}
                          style={{ marginTop: '10px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Open tracker
                        </button>
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )}

        <div className={styles.adminLayout}>
          <div>
            <div className={styles.sectionLabel}>Active Clients ({allClients.length})</div>
            <div className={styles.clientGrid}>
              {allClients.map(c => (
                <div
                  key={c.id}
                  className={styles.clientCard}
                  style={c.approval_status === 'pending' ? {
                    boxShadow: `0 0 20px 0 ${c.primary_color}22`,
                    border: `1px solid ${c.primary_color}55`
                  } : undefined}
                >
                  <div className={styles.clientCardMain}>
                    <div className={styles.clientSwatch} style={{ background: c.primary_color }} />
                    <div className={styles.clientInfo}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className={styles.clientName}>{c.name}</div>
                        {c.approval_status === 'pending' && c.approval_sent_at && (() => {
                          const daysActive = Math.floor((Date.now() - new Date(c.approval_sent_at).getTime()) / (1000 * 60 * 60 * 24))
                          return daysActive < 1 ? (
                            <span style={{ fontSize: '10px', color: 'var(--teal)', background: 'rgba(29,158,117,0.15)', padding: '1px 7px', borderRadius: '20px' }}>live</span>
                          ) : null
                        })()}
                      </div>
                      <div className={styles.clientSlug}>/{c.slug}</div>
                      {(() => {
                        const stage = deriveStage(c)
                        if (stage === 'none') return null
                        const stages = [
                          { key: 'uploaded', label: 'Uploaded', color: 'var(--teal)' },
                          { key: 'in_review', label: 'In review', color: 'var(--gold-light)' },
                          { key: 'revisions', label: 'Revisions', color: '#F0997B' },
                          { key: 'approved', label: 'Approved', color: 'var(--teal)' }
                        ]
                        const activeIdx = stages.findIndex(s => s.key === stage)
                        const days = c.approval_sent_at ? Math.floor((Date.now() - new Date(c.approval_sent_at).getTime()) / (1000 * 60 * 60 * 24)) : null
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', width: '180px', flexShrink: 0 }}>
                              {stages.map((s, i) => {
                                const filled = activeIdx >= i && activeIdx !== -1
                                const isActive = activeIdx === i
                                return (
                                  <span key={s.key} style={{
                                    height: '4px', flex: '1 1 0', minWidth: 0,
                                    borderRadius: i === 0 ? '2px 0 0 2px' : i === stages.length - 1 ? '0 2px 2px 0' : 0,
                                    background: isActive
                                      ? `linear-gradient(90deg, ${s.color} 0%, ${s.color} 38%, rgba(255,255,255,0.65) 50%, ${s.color} 62%, ${s.color} 100%)`
                                      : filled ? s.color : 'var(--border)',
                                    backgroundSize: isActive ? '220% 100%' : '100% 100%',
                                    animation: isActive
                                      ? 'gmmStageSweep 2.4s linear infinite, gmmStagePulse 2.4s ease-in-out infinite'
                                      : 'none',
                                    '--gmm-pulse': s.color
                                  }} />
                                )
                              })}
                            </div>
                            <span style={{ fontSize: '11px', color: stages[activeIdx]?.color || 'var(--text3)', whiteSpace: 'nowrap' }}>
                              {stages[activeIdx]?.label}{days !== null ? ` · ${days}d` : ''}
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                    <div className={styles.clientActions} style={{ flexDirection: 'row', gap: '6px' }}>
                      <button
                        className={styles.editBtn}
                        onClick={() => setTrackerOpen(trackerOpen === c.id ? null : c.id)}
                        title="View and control production status"
                        style={trackerOpen === c.id ? { color: 'var(--gold-light)' } : undefined}
                      >
                        <i className="ti ti-chart-bar" aria-hidden="true" /> Tracker
                      </button>
                      <button
                        className={styles.editBtn}
                        onClick={() => resyncFiles(c)}
                        disabled={resyncing[c.id]}
                        title="Recount files from Dropbox after manual changes"
                      >
                        <i className={`ti ti-refresh${resyncing[c.id] ? ' spin' : ''}`} aria-hidden="true" /> {resyncing[c.id] ? 'Resyncing...' : 'Resync Files'}
                      </button>
                      <button
                        className={styles.editBtn}
                        onClick={() => { switchClient(c.id); navigate('/content') }}
                        title="Browse to the folder you want to submit and click Send for Review there"
                      >
                        <i className="ti ti-send" aria-hidden="true" /> Send for Review
                      </button>
                      <button className={styles.editBtn} onClick={() => setEditingClient({...c})}>
                        <i className="ti ti-pencil" aria-hidden="true" /> Edit
                      </button>
                    </div>
                  </div>

                  {trackerOpen === c.id && (() => {
                    const roll = trackerRollup[c.id] || { approved: 0, in_review: 0, revision: 0 }
                    const statusOptions = [
                      { key: 'none', label: 'Neutral' },
                      { key: 'pending', label: 'In review' },
                      { key: 'revision', label: 'Revisions' },
                      { key: 'approved', label: 'Approved' }
                    ]
                    const currentStatus = c.approval_status || 'none'
                    return (
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '14px' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                          <div style={{ background: 'var(--surface2)', borderRadius: '7px', padding: '8px 14px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                            <span style={{ fontSize: '16px', color: 'var(--teal)' }}>{roll.approved}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>approved</span>
                          </div>
                          <div style={{ background: 'var(--surface2)', borderRadius: '7px', padding: '8px 14px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                            <span style={{ fontSize: '16px', color: 'var(--gold-light)' }}>{roll.in_review}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>awaiting client</span>
                          </div>
                          <div style={{ background: 'var(--surface2)', borderRadius: '7px', padding: '8px 14px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                            <span style={{ fontSize: '16px', color: '#F0997B' }}>{roll.revision}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>needs revision</span>
                          </div>
                          {c.approval_folder_path && (
                            <button
                              className={styles.editBtn}
                              onClick={() => { switchClient(c.id); navigate('/content', { state: { jumpToFolderPath: c.approval_folder_path } }) }}
                              style={{ whiteSpace: 'nowrap', color: 'var(--gold-light)', marginLeft: 'auto' }}
                            >
                              Open folder <i className="ti ti-arrow-right" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {statusOptions.map(opt => {
                              const active = currentStatus === opt.key
                              return (
                                <button
                                  key={opt.key}
                                  onClick={() => setClientStatus(c, opt.key)}
                                  disabled={settingStatus || active}
                                  style={{
                                    background: active ? 'var(--gold-bg)' : 'var(--surface2)',
                                    border: `0.5px solid ${active ? 'var(--gold-light)' : 'var(--border)'}`,
                                    color: active ? 'var(--gold-light)' : 'var(--text2)',
                                    borderRadius: '20px',
                                    padding: '4px 12px',
                                    fontSize: '11px',
                                    cursor: active ? 'default' : 'pointer'
                                  }}
                                >
                                  {opt.label}
                                </button>
                              )
                            })}
                          </div>
                          <span style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
                          <button
                            className="btn btn-gold"
                            style={{ fontSize: '12px' }}
                            onClick={() => { switchClient(c.id); navigate('/content') }}
                          >
                            <i className="ti ti-send" aria-hidden="true" /> Send for review
                          </button>
                          <button
                            className="btn"
                            style={{ fontSize: '12px' }}
                            onClick={() => clearReview(c)}
                            disabled={!c.approval_status}
                          >
                            Clear review
                          </button>
                          <button
                            className="btn"
                            style={{ fontSize: '12px', opacity: 0.5 }}
                            onClick={() => showToast('Nudge is coming soon')}
                            title="Coming soon — sends the client a reminder about pending review"
                          >
                            Nudge client
                          </button>
                        </div>
                      </div>
                    )
                  })()}

                  {editingClient?.id === c.id && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '16px' }}>
                      <div className={styles.formGrid}>
                        <div className={styles.field}>
                          <label className={styles.label}>Client Name</label>
                          <input className={styles.input} value={editingClient.name} onChange={e => setEditingClient(p => ({...p, name: e.target.value}))} />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Notification Email</label>
                          <input
                            className={styles.input}
                            type="email"
                            value={editingClient.notification_email || ''}
                            onChange={e => setEditingClient(p => ({...p, notification_email: e.target.value}))}
                            placeholder="client@example.com"
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Primary Accent</label>
                          <div className={styles.colorRow}>
                            <input type="color" className={styles.colorPicker} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                            <input className={styles.input} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                          </div>
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Secondary Accent</label>
                          <div className={styles.colorRow}>
                            <input type="color" className={styles.colorPicker} value={editingClient.secondary_color} onChange={e => setEditingClient(p => ({...p, secondary_color: e.target.value}))} />
                            <input className={styles.input} value={editingClient.secondary_color} onChange={e => setEditingClient(p => ({...p, secondary_color: e.target.value}))} />
                          </div>
                        </div>
                      </div>

                      {/* Existing team members for this client */}
                      {teamMembers.filter(m => m.client_id === editingClient.id).length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '4px' }}>
                          <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '10px' }}>Current Portal Access</div>
                          {teamMembers.filter(m => m.client_id === editingClient.id).map(m => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                              <i className="ti ti-user" style={{ fontSize: '14px', color: 'var(--text3)' }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', color: 'var(--text)' }}>{m.email || 'No email on file'}</div>
                              </div>
                              <button
                                className={styles.editBtn}
                                onClick={() => removeTeamMember(m)}
                                title="Remove portal access"
                                style={{ color: 'var(--coral, #e0845a)', fontSize: '12px' }}
                              >
                                <i className="ti ti-trash" /> Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add another team member */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '4px' }}>
                        <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '12px' }}>
                          {teamMembers.filter(m => m.client_id === editingClient.id).length > 0 ? 'Add Another Team Member' : 'Portal Access'}
                        </div>
                        <div className={styles.formGrid}>
                          <div className={styles.field}>
                            <label className={styles.label}>Login Email</label>
                            <input
                              className={styles.input}
                              type="email"
                              value={newMember.email}
                              onChange={e => setNewMember(p => ({...p, email: e.target.value}))}
                              placeholder="teammate@example.com"
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.label}>Temporary Password</label>
                            <input
                              className={styles.input}
                              type="password"
                              value={newMember.password}
                              onChange={e => setNewMember(p => ({...p, password: e.target.value}))}
                              placeholder="Leave blank to auto-generate"
                            />
                          </div>
                        </div>
                        <button
                          className="btn btn-gold"
                          style={{ fontSize: '12px' }}
                          onClick={async () => {
                            if (!newMember.email) return showToast('Enter an email')
                            setSaving(true)
                            const password = newMember.password || generatePassword()
                            const { data, error } = await supabase.functions.invoke('create-user', {
                              body: { email: newMember.email, password, client_id: editingClient.id, role: 'member' }
                            })
                            if (error) {
                              let message = 'Failed to create user.'
                              try {
                                const body = await error.context?.json()
                                if (body?.error) message = body.error
                              } catch {}
                              showToast(message)
                            } else if (data?.error) {
                              showToast(data.error)
                            } else {
                              await apiFetch('/api/send-email', {
                                method: 'POST',
                                body: JSON.stringify({
                                  type: 'welcome',
                                  clientName: editingClient.name,
                                  recipientEmail: newMember.email
                                })
                              })
                              showToast('Portal access created — welcome email sent!')
                              setNewMember({ email: '', password: '', client_id: '', role: 'member' })
                              await loadTeam()
                            }
                            setSaving(false)
                          }}
                          disabled={saving}
                        >
                          <i className="ti ti-user-plus" aria-hidden="true" /> Add Portal Access
                        </button>
                      </div>

                      <div className={styles.formActions}>
                        <button className="btn" onClick={() => setEditingClient(null)}>Cancel</button>
                        <button className="btn btn-gold" onClick={saveClientBranding} disabled={saving}>Save Branding</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Onboard New Client</div>
            <div className={styles.formCard}>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Client Name</label>
                <input className={styles.input} value={newClient.name} onChange={e => setNewClient(p => ({...p, name: e.target.value}))} placeholder="e.g. Acme Brand Co." />
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Primary Accent</label>
                <div className={styles.colorRow}>
                  <input type="color" className={styles.colorPicker} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                  <input className={styles.input} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                </div>
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Secondary Accent</label>
                <div className={styles.colorRow}>
                  <input type="color" className={styles.colorPicker} value={newClient.secondary_color} onChange={e => setNewClient(p => ({...p, secondary_color: e.target.value}))} />
                  <input className={styles.input} value={newClient.secondary_color} onChange={e => setNewClient(p => ({...p, secondary_color: e.target.value}))} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '12px' }}>Portal Access</div>
                <div className={styles.field} style={{ marginBottom: '12px' }}>
                  <label className={styles.label}>Login Email</label>
                  <input
                    className={styles.input}
                    type="email"
                    value={newMember.email}
                    onChange={e => setNewMember(p => ({...p, email: e.target.value}))}
                    placeholder="client@example.com"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Temporary Password</label>
                  <input
                    className={styles.input}
                    type="password"
                    value={newMember.password}
                    onChange={e => setNewMember(p => ({...p, password: e.target.value}))}
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
              </div>
              <button
                className="btn btn-gold"
                style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
                onClick={onboardClient}
                disabled={saving || !newClient.name.trim()}
              >
                <i className="ti ti-user-plus" aria-hidden="true" /> Onboard Client
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <div className={styles.sectionLabel}>Activity</div>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 16px' }}>
            {activityLoading && <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text3)' }}>Loading...</div>}
            {!activityLoading && activityFeed.length === 0 && (
              <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text3)' }}>No recent activity</div>
            )}
            {activityFeed.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 0', borderBottom: i < activityFeed.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color, marginTop: '6px', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: 'var(--text1)' }}>{item.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{item.subtitle}</div>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{item.relativeTime}</span>
              </div>
            ))}
          </div>
        </div>
        </>
      )}

      {tab === 'team' && (
        <div className={styles.adminLayout}>
          <div>
            <div className={styles.sectionLabel}>Portal Accounts</div>
            <div className={styles.teamList}>
              {teamMembers.map((m, i) => (
                <div key={i} className={styles.teamRow}>
                  <div className={styles.teamAvatar}>
                    {m.role === 'admin' ? <i className="ti ti-shield" aria-hidden="true" /> : m.role === 'editor' ? <i className="ti ti-pencil" aria-hidden="true" /> : <i className="ti ti-user" aria-hidden="true" />}
                  </div>
                  <div className={styles.teamInfo}>
                    <div className={styles.teamRole}>{m.email || 'No email on file'}</div>
                    <div className={styles.teamClient}>{m.role === 'admin' ? 'Admin' : m.role === 'editor' ? 'Editor' : m.clients?.name || 'Unassigned'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className={styles.teamBadge} style={{
                      background: m.role === 'admin' ? 'var(--gold-bg)' : m.role === 'editor' ? 'rgba(93,202,165,0.14)' : 'var(--teal-bg)',
                      color: m.role === 'admin' ? 'var(--gold-light)' : m.role === 'editor' ? 'var(--teal)' : 'var(--teal)'
                    }}>
                      {m.role}
                    </div>
                    {m.role !== 'admin' && (
                      <button
                        className={styles.editBtn}
                        onClick={() => removeTeamMember(m)}
                        title="Remove portal access"
                        style={{ color: 'var(--coral, #e0845a)', fontSize: '12px' }}
                      >
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {teamMembers.length === 0 && (
                <div className={styles.empty}>No accounts yet</div>
              )}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Add Team Member</div>
            <div className={styles.formCard}>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.input}
                  value={newMember.role === 'member' ? 'editor' : newMember.role}
                  onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="editor">Editor — can manage files, send for review</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Login Email</label>
                <input
                  className={styles.input}
                  type="email"
                  value={newMember.email}
                  onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))}
                  placeholder="colleague@example.com"
                />
              </div>
              <div className={styles.field} style={{ marginBottom: '16px' }}>
                <label className={styles.label}>Temporary Password</label>
                <input
                  className={styles.input}
                  type="password"
                  value={newMember.password}
                  onChange={e => setNewMember(p => ({ ...p, password: e.target.value }))}
                  placeholder="Leave blank to auto-generate"
                />
              </div>
              <button
                className="btn btn-gold"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={saving || !newMember.email}
                onClick={async () => {
                  if (!newMember.email) return showToast('Enter an email')
                  setSaving(true)
                  const password = newMember.password || generatePassword()
                  const role = newMember.role === 'member' ? 'editor' : newMember.role
                  const { data, error } = await supabase.functions.invoke('create-user', {
                    body: { email: newMember.email, password, role, client_id: null }
                  })
                  if (error) {
                    let message = 'Failed to create user.'
                    try {
                      const body = await error.context?.json()
                      if (body?.error) message = body.error
                    } catch {}
                    showToast(message)
                  } else if (data?.error) {
                    showToast(data.error)
                  } else {
                    await apiFetch('/api/send-email', {
                      method: 'POST',
                      body: JSON.stringify({
                        type: 'welcome',
                        clientName: 'Glowing Moon Media',
                        recipientEmail: newMember.email
                      })
                    })
                    showToast(`${role.charAt(0).toUpperCase() + role.slice(1)} account created — welcome email sent!`)
                    setNewMember({ email: '', password: '', client_id: '', role: 'member' })
                    await loadTeam()
                  }
                  setSaving(false)
                }}
              >
                <i className="ti ti-user-plus" /> Add Team Member
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'revisions' && (
        <div>
          <div className={styles.sectionLabel}>Client Revision Notes</div>
          {loadingComments && <div className={styles.empty}>Loading...</div>}
          {!loadingComments && comments.length === 0 && (
            <div className={styles.empty}>No revision notes yet</div>
          )}
          {Object.entries(commentsByClient).map(([clientName, { color, items }]) => (
            <div key={clientName} style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color || 'var(--gold)' }} />
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{clientName}</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{items.length} note{items.length !== 1 ? 's' : ''}</div>
              </div>
              <div className={styles.teamList}>
                {items.map(c => (
                  <div key={c.id} className={styles.teamRow} style={{ alignItems: 'flex-start', gap: '12px' }}>
                    <div className={styles.teamAvatar} style={{ marginTop: '2px' }}>
                      <i className="ti ti-message" />
                    </div>
                    <div className={styles.teamInfo} style={{ flex: 1 }}>
                      <div className={styles.teamRole} style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>
                        {c.file_path.split('/').pop()}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5' }}>{c.comment}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '6px' }}>
                        {new Date(c.created_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className={styles.editBtn}
                      onClick={() => dismissComment(c.id)}
                      title="Dismiss"
                      style={{ marginTop: '2px', flexShrink: 0 }}
                    >
                      <i className="ti ti-check" /> Done
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div>
          <div className={styles.sectionLabel}>Recent Activity (last 100 events)</div>
          {loadingLogs && <div className={styles.empty}>Loading audit logs...</div>}
          {!loadingLogs && auditLogs.length === 0 && (
            <div className={styles.empty}>No activity logged yet</div>
          )}
          <div className={styles.teamList}>
            {auditLogs.map((log, i) => (
              <div key={i} className={styles.teamRow}>
                <div className={styles.teamAvatar}>
                  {log.action === 'login' && <i className="ti ti-login" />}
                  {log.action === 'download' && <i className="ti ti-download" />}
                  {log.action === 'delete' && <i className="ti ti-trash" />}
                  {log.action === 'upload' && <i className="ti ti-upload" />}
                  {!['login','download','delete','upload'].includes(log.action) && <i className="ti ti-activity" />}
                </div>
                <div className={styles.teamInfo}>
                  <div className={styles.teamRole}>{log.user_email}</div>
                  <div className={styles.teamClient}>
                    {log.action} · {log.resource}
                    {log.details?.fileName ? ` · ${log.details.fileName}` : ''}
                  </div>
                </div>
                <div className={styles.teamBadge} style={{ background: 'var(--gold-bg)', color: 'var(--gold-light)', fontSize: '12px' }}>
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  )
}

