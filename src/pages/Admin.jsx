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
    })
    setEditingClient(null)
    showToast('Branding saved!')
    setSaving(false)
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

  async function assignRole(userId, clientId, role) {
    await supabase.from('user_roles').upsert({
      user_id: userId,
      client_id: clientId || null,
      role
    }, { onConflict: 'user_id,client_id' })
    await loadTeam()
    showToast('Role updated!')
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <p className={styles.sub}>Manage clients, branding, and team access</p>
      </div>

      <div className={styles.tabs}>
       {['clients','team','audit'].map(t => (
         <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => { setTab(t); if (t === 'audit') loadAuditLogs() }}>
  {t === 'clients' ? 'Clients' : t === 'team' ? 'Team Members' : 'Audit Log'}
</button>
        ))}
      </div>

      {tab === 'clients' && (
        <div>
          {/* Existing clients */}
          <div className={styles.sectionLabel}>Active Clients ({allClients.length})</div>
          <div className={styles.clientGrid}>
            {allClients.map(c => (
              <div key={c.id} className={styles.clientCard}>
                <div className={styles.clientSwatch} style={{ background: c.primary_color }} />
                <div className={styles.clientInfo}>
                  <div className={styles.clientName}>{c.name}</div>
                  <div className={styles.clientSlug}>/{c.slug}</div>
                </div>
                <button className={styles.editBtn} onClick={() => setEditingClient({...c})}>
                  <i className="ti ti-pencil" aria-hidden="true" /> Edit
                </button>
              </div>
            ))}
          </div>

          {/* Edit client branding */}
          {editingClient && (
            <div className={styles.formCard}>
              <div className={styles.formTitle}>Edit — {editingClient.name}</div>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Client Name</label>
                  <input className={styles.input} value={editingClient.name} onChange={e => setEditingClient(p => ({...p, name: e.target.value}))} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Primary Color</label>
                  <div className={styles.colorRow}>
                    <input type="color" className={styles.colorPicker} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                    <input className={styles.input} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Background Color</label>
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

          {/* New client form */}
          <div className={styles.formCard}>
            <div className={styles.formTitle}>Add New Client</div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Client Name</label>
                <input className={styles.input} value={newClient.name} onChange={e => setNewClient(p => ({...p, name: e.target.value}))} placeholder="e.g. Acme Brand Co." />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Primary Color</label>
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
