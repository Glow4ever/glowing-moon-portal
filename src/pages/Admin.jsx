import { logAction } from '../lib/audit'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useClient } from '../lib/ClientContext'
import styles from './Admin.module.css'

export default function Admin() {
  const { allClients, updateClientBranding, loadUserContext } = useClient()
  const [tab, setTab] = useState('clients')
  const [teamMembers, setTeamMembers] = useState([])
  const [newClient, setNewClient] = useState({ name: '', primary_color: '#c9a84c', secondary_color: '#0a0a0b' })
  const [newMember, setNewMember] = useState({ email: '', password: '', client_id: '', role: 'member' })
  const [editingClient, setEditingClient] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [auditLogs, setAuditLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [reviewMonth, setReviewMonth] = useState({})
  const [plannedPosts, setPlannedPosts] = useState({})
  const [sendingReview, setSendingReview] = useState({})
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const currentYear = new Date().getFullYear()

  useEffect(() => { loadTeam() }, [])

  async function loadTeam() {
    const { data } = await supabase
      .from('user_roles')
      .select('*, clients(name)')
      .order('created_at')
    if (data) setTeamMembers(data)
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

  async function createClient() {
    if (!newClient.name.trim()) return
    setSaving(true)
    const slug = newClient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const { error } = await supabase.from('clients').insert({
      name: newClient.name.trim(),
      slug,
      primary_color: newClient.primary_color,
      secondary_color: newClient.secondary_color,
      active: true
    })
    if (!error) {
      setNewClient({ name: '', primary_color: '#c9a84c', secondary_color: '#0a0a0b' })
      await loadUserContext()
      showToast('Client created!')
    }
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
    })
    setEditingClient(null)
    showToast('Branding saved!')
    setSaving(false)
  }

  async function sendForReview(client) {
    const month = reviewMonth[client.id]
    if (!month) return showToast('Select a month first')
    if (!client.notification_email) return showToast('No notification email set for this client')

    setSendingReview(p => ({ ...p, [client.id]: true }))

    const [monthName, year] = month.split(' ')

    await supabase.from('clients').update({
      approval_status: 'pending',
      approval_month: month
    }).eq('id', client.id)

    await supabase.from('content_months').upsert({
      client_id: client.id,
      month: monthName,
      year: parseInt(year),
      planned: plannedPosts[client.id] || 0,
      approval_status: 'pending'
    }, { onConflict: 'client_id,month,year' })

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'review',
        clientName: client.name,
        month,
        portalLink: 'https://portal.glowingmoonmedia.com',
        notificationEmail: client.notification_email
      })
    })

    if (res.ok) {
      await loadUserContext()
      showToast(`Review email sent to ${client.notification_email}`)
    } else {
      showToast('Email failed — check Vercel logs')
    }

    setSendingReview(p => ({ ...p, [client.id]: false }))
  }

  async function inviteMember() {
    if (!newMember.email || !newMember.password || !newMember.client_id) return
    setSaving(true)
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: {
        email: newMember.email,
        password: newMember.password,
        client_id: newMember.client_id,
        role: newMember.role
      }
    })
    if (error || data?.error) {
      showToast(data?.error || 'Failed to create user. Try again.')
      setSaving(false)
      return
    }
    showToast('Client user created successfully!')
    setNewMember({ email: '', password: '', client_id: '', role: 'member' })
    await loadTeam()
    setSaving(false)
  }

  function getStatusBadge(status) {
    if (!status || status === 'none') return null
    const map = {
      pending: { bg: 'var(--gold-bg)', color: 'var(--gold-light)', label: 'Pending Review' },
      approved: { bg: 'var(--teal-bg)', color: 'var(--teal)', label: 'Approved' },
      revision: { bg: '#2a1a1a', color: '#ff6b6b', label: 'Revision Requested' }
    }
    const s = map[status]
    if (!s) return null
    return <div className={styles.teamBadge} style={{ background: s.bg, color: s.color }}>{s.label}</div>
  }

  // Group comments by client
  const commentsByClient = comments.reduce((acc, c) => {
    const name = c.clients?.name || 'Unknown'
    if (!acc[name]) acc[name] = { color: c.clients?.primary_color, items: [] }
    acc[name].items.push(c)
    return acc
  }, {})

  return (
    <div className={styles.page}>
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
        <div>
          <div className={styles.sectionLabel}>Active Clients ({allClients.length})</div>
          <div className={styles.clientGrid}>
            {allClients.map(c => (
              <div key={c.id} className={styles.clientCard}>
                <div className={styles.clientSwatch} style={{ background: c.primary_color }} />
                <div className={styles.clientInfo}>
                  <div className={styles.clientName}>{c.name}</div>
                  <div className={styles.clientSlug}>/{c.slug}</div>
                  {c.approval_month && getStatusBadge(c.approval_status)}
                </div>
                <div className={styles.clientActions}>
                  <select
                    className={styles.input}
                    style={{ width: '140px', padding: '6px 8px', fontSize: '13px' }}
                    value={reviewMonth[c.id] || ''}
                    onChange={e => setReviewMonth(p => ({ ...p, [c.id]: e.target.value }))}
                  >
                    <option value="">Select month...</option>
                    {MONTHS.map(m => (
                      <option key={m} value={`${m} ${currentYear}`}>{m} {currentYear}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className={styles.input}
                    style={{ width: '70px', padding: '6px 8px', fontSize: '13px' }}
                    value={plannedPosts[c.id] || ''}
                    onChange={e => setPlannedPosts(p => ({ ...p, [c.id]: parseInt(e.target.value) || 0 }))}
                    placeholder="# posts"
                    min="0"
                  />
                  <button
                    className="btn btn-gold"
                    style={{ whiteSpace: 'nowrap', fontSize: '13px' }}
                    onClick={() => sendForReview(c)}
                    disabled={sendingReview[c.id] || !reviewMonth[c.id]}
                  >
                    {sendingReview[c.id] ? 'Sending...' : 'Send for Review'}
                  </button>
                  <button className={styles.editBtn} onClick={() => setEditingClient({...c})}>
                    <i className="ti ti-pencil" aria-hidden="true" /> Edit
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editingClient && (
            <div className={styles.formCard}>
              <div className={styles.formTitle}>Edit — {editingClient.name}</div>
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
                  <label className={styles.label}>Primary Color</label>
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
              <div className={styles.formActions}>
                <button className="btn" onClick={() => setEditingClient(null)}>Cancel</button>
                <button className="btn btn-gold" onClick={saveClientBranding} disabled={saving}>Save Branding</button>
              </div>
            </div>
          )}

          <div className={styles.formCard}>
            <div className={styles.formTitle}>Add New Client</div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Client Name</label>
                <input className={styles.input} value={newClient.name} onChange={e => setNewClient(p => ({...p, name: e.target.value}))} placeholder="e.g. Acme Brand Co." />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Primary Accent</label>
                <div className={styles.colorRow}>
                  <input type="color" className={styles.colorPicker} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                  <input className={styles.input} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                </div>
              </div>
            </div>
            <div className={styles.formActions}>
              <button className="btn btn-gold" onClick={createClient} disabled={saving || !newClient.name.trim()}>
                <i className="ti ti-plus" aria-hidden="true" /> Create Client
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'team' && (
        <div>
          <div className={styles.sectionLabel}>Team Members & Roles</div>
          <div className={styles.teamList}>
            {teamMembers.map((m, i) => (
              <div key={i} className={styles.teamRow}>
                <div className={styles.teamAvatar}>
                  {m.role === 'admin' ? <i className="ti ti-shield" aria-hidden="true" /> : <i className="ti ti-user" aria-hidden="true" />}
                </div>
                <div className={styles.teamInfo}>
                  <div className={styles.teamRole}>{m.role === 'admin' ? 'Admin' : 'Client Member'}</div>
                  <div className={styles.teamClient}>{m.clients?.name || 'All clients (admin)'}</div>
                </div>
                <div className={styles.teamBadge} style={{ background: m.role === 'admin' ? 'var(--gold-bg)' : 'var(--teal-bg)', color: m.role === 'admin' ? 'var(--gold-light)' : 'var(--teal)' }}>
                  {m.role}
                </div>
              </div>
            ))}
            {teamMembers.length === 0 && (
              <div className={styles.empty}>No team members yet</div>
            )}
          </div>

          <div className={styles.formCard}>
            <div className={styles.formTitle}>Add New Client User</div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
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
                  placeholder="Min 8 characters"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Assign to Client</label>
                <select
                  className={styles.input}
                  value={newMember.client_id}
                  onChange={e => setNewMember(p => ({...p, client_id: e.target.value}))}
                >
                  <option value="">Select client...</option>
                  {allClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                className="btn btn-gold"
                onClick={inviteMember}
                disabled={saving || !newMember.email || !newMember.password || !newMember.client_id}
              >
                <i className="ti ti-user-plus" aria-hidden="true" /> Create User
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
                <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{items.length} note{items.length !== 1 ? 's' : ''}</div>
              </div>
              <div className={styles.teamList}>
                {items.map(c => (
                  <div key={c.id} className={styles.teamRow} style={{ alignItems: 'flex-start', gap: '12px' }}>
                    <div className={styles.teamAvatar} style={{ marginTop: '2px' }}>
                      <i className="ti ti-message" />
                    </div>
                    <div className={styles.teamInfo} style={{ flex: 1 }}>
                      <div className={styles.teamRole} style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '4px' }}>
                        {c.file_path.split('/').pop()}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5' }}>{c.comment}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>
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
                <div className={styles.teamBadge} style={{ background: 'var(--gold-bg)', color: 'var(--gold-light)', fontSize: '11px' }}>
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
