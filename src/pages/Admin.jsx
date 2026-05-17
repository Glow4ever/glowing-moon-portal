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

  useEffect(() => { loadTeam() }, [])

  async function loadTeam() {
    const { data } = await supabase
      .from('user_roles')
      .select('*, clients(name)')
      .order('created_at')
    if (data) setTeamMembers(data)
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
    if (!newMember.email || !newMember.password) return
    setSaving(true)
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin
      ? await supabase.functions.invoke('create-user', { body: newMember })
      : { data: null, error: { message: 'Use Supabase dashboard to invite users' } }

    if (authError) {
      showToast('Add user via Supabase Auth dashboard, then assign role below')
      setSaving(false)
      return
    }
    showToast('Member invited!')
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
        {['clients','team'].map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
            {t === 'clients' ? 'Clients' : 'Team Members'}
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
          <div className={styles.infoBox}>
            <i className="ti ti-info-circle" aria-hidden="true" />
            To add a new team member or client user, first create their account in <a href="https://supabase.com/dashboard/project/sqakattqftlmstsbxgxw/auth/users" target="_blank" rel="noreferrer" style={{color:'var(--gold-light)'}}>Supabase Auth</a>, then assign their role below.
          </div>

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

      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  )
}
