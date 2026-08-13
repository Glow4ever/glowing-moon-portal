import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useClient } from '../lib/ClientContext'
import styles from './Topbar.module.css'

export default function Topbar() {
  const { client, role, allClients, switchClient } = useClient()
  const navigate = useNavigate()
  const [logoUrl, setLogoUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const fileRef = useRef()
  const notifRef = useRef()

  const primaryColor = client?.primary_color || '#c9a84c'
  const logoPath = `logos/${client?.slug}-logo`

  useEffect(() => {
    if (client?.slug) loadLogo()
  }, [client])

  useEffect(() => {
    if (role === 'admin') loadNotifications()
  }, [role])

  useEffect(() => {
    function handleClickOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadNotifications() {
    const [{ data: approvals }, { data: comments }] = await Promise.all([
      supabase.from('notifications').select('*, clients(name, primary_color)').order('created_at', { ascending: false }).limit(20),
      supabase.from('file_comments').select('*, clients(name, primary_color)').eq('read', false).order('created_at', { ascending: false }).limit(20)
    ])

    const combined = [
      ...(approvals || []).map(n => ({ ...n, source: 'notification' })),
      ...(comments || []).map(c => ({
        id: c.id,
        type: 'revision',
        message: `${c.clients?.name} left a revision note on ${c.file_path.split('/').pop()}`,
        read: c.read,
        created_at: c.created_at,
        clients: c.clients,
        client_id: c.client_id,
        file_path: c.file_path,
        source: 'comment'
      }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)

    setNotifications(combined)
    setUnreadCount(combined.filter(n => !n.read).length)
  }

  async function markAllRead() {
    await Promise.all([
      supabase.from('notifications').update({ read: true }).eq('read', false),
      supabase.from('file_comments').update({ read: true }).eq('read', false)
    ])
    await loadNotifications()
  }

  async function markOneRead(n) {
    if (n.read) return
    const table = n.source === 'comment' ? 'file_comments' : 'notifications'
    await supabase.from(table).update({ read: true }).eq('id', n.id)
    await loadNotifications()
  }

  function goToNotification(n) {
    markOneRead(n)
    if (n.source === 'comment' && n.file_path && n.client_id) {
      switchClient(n.client_id)
      const folderPath = n.file_path.substring(0, n.file_path.lastIndexOf('/'))
      navigate('/content', { state: { jumpToFolderPath: folderPath } })
    }
    setShowNotifications(false)
  }

  async function loadLogo() {
    const extensions = ['png', 'jpg', 'jpeg', 'svg', 'webp']
    for (const ext of extensions) {
      const path = `${logoPath}.${ext}`
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      const url = data.publicUrl
      try {
        const res = await fetch(url, { method: 'HEAD' })
        if (res.ok) {
          setLogoUrl(url + '?t=' + Date.now())
          return
        }
      } catch {}
    }
    setLogoUrl(null)
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${logoPath}.${ext}`
    const { error } = await supabase.storage
      .from('portal-assets')
      .upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      setLogoUrl(data.publicUrl + '?t=' + Date.now())
      setToast('Logo updated!')
      setTimeout(() => setToast(''), 2500)
    }
    setUploading(false)
  }

  async function handleLogoDelete(e) {
    e.stopPropagation()
    const extensions = ['png', 'jpg', 'jpeg', 'svg', 'webp']
    for (const ext of extensions) {
      await supabase.storage.from('portal-assets').remove([`${logoPath}.${ext}`])
    }
    setLogoUrl(null)
    setToast('Logo removed!')
    setTimeout(() => setToast(''), 2500)
  }

  function timeAgo(str) {
    const diff = Date.now() - new Date(str).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.logo} onClick={() => fileRef.current.click()} title="Click to update logo">
        <input type="file" ref={fileRef} accept="image/*" style={{ display:'none' }} onChange={handleLogoUpload} />
        <div className={styles.logoCircle} style={{ borderColor: primaryColor + '55' }}>
          {logoUrl
            ? <img
                src={logoUrl}
                alt="Logo"
                style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%', padding: '4px' }}
              />
            : <span className={styles.logoInitials} style={{ color: primaryColor }}>
                {client?.name?.split(' ').map(w => w[0]).join('').slice(0,2) || 'GM'}
              </span>
          }
          {logoUrl && role === 'admin' && (
            <button
              onClick={handleLogoDelete}
              style={{ position:'absolute', top:'0px', right:'0px', width:'12px', height:'12px', borderRadius:'50%', background:'#e0845a', border:'none', color:'white', fontSize:'7px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', zIndex:10, opacity:0 }}
            >
              <i className="ti ti-x" />
            </button>
          )}
          <div className={styles.logoOverlay}>
            <i className={`ti ${uploading ? 'ti-loader' : 'ti-camera'}`} aria-hidden="true" />
          </div>
        </div>
        <div className={styles.logoText}>
          {client?.name || 'Glowing Moon Media'}
        </div>
        <div className={styles.logoHint}>
          <i className="ti ti-upload" style={{ fontSize:'9px' }} aria-hidden="true" /> Click to update logo
        </div>
      </div>

      <div className={styles.center}>
        <span>Client Portal</span>
        <span className={styles.dot}>·</span>
        <div className={styles.pill} style={{ background: primaryColor + '18', borderColor: primaryColor + '40', color: primaryColor }}>
          {client?.name || 'Glowing Moon Media'}
        </div>
      </div>

      <div className={styles.right}>
        {(role === 'admin' || role === 'editor') && allClients.length > 1 && (
          <div className={styles.switcherWrap}>
            <button
              className={styles.switcherBtn}
              onClick={() => setShowSwitcher(s => !s)}
              title="Switch client view"
            >
              <i className="ti ti-switch-horizontal" aria-hidden="true" />
              <span>Switch Client</span>
            </button>
            {showSwitcher && (
              <div className={styles.switcherDropdown}>
                <div className={styles.switcherTitle}>View as client</div>
                {allClients.map(c => (
                  <div
                    key={c.id}
                    className={`${styles.switcherItem} ${client?.id === c.id ? styles.switcherActive : ''}`}
                    onClick={() => { switchClient(c.id); setShowSwitcher(false) }}
                  >
                    <div className={styles.switcherDot} style={{ background: c.primary_color || '#c9a84c' }} />
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {role === 'admin' && (
          <div className={styles.notifWrap} ref={notifRef}>
            <button
              className={styles.iconBtn}
              aria-label="Notifications"
              onClick={() => { setShowNotifications(s => !s); if (!showNotifications) loadNotifications() }}
              style={{ position: 'relative' }}
            >
              <i className="ti ti-bell" aria-hidden="true" />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-4px', right: '-4px',
                  background: '#D3C9A7', color: '#000',
                  borderRadius: '50%', width: '16px', height: '16px',
                  fontSize: '9px', fontWeight: '700',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className={styles.notifDropdown}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)' }}>Notifications</div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      style={{ fontSize: '12px', color: 'var(--gold-light)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                {notifications.length === 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '16px 0' }}>
                    No notifications yet
                  </div>
                )}

                {notifications.map((n, i) => (
                  <div
                    key={i}
                    onClick={() => goToNotification(n)}
                    style={{
                      display: 'flex', gap: '10px', padding: '10px 0',
                      borderBottom: '1px solid var(--border)',
                      opacity: n.read ? 0.5 : 1,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50', flexShrink: 0, marginTop: '4px',
                      background: n.type === 'approval' ? 'var(--teal)' : '#D3C9A7'
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: '1.4' }}>{n.message}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>{timeAgo(n.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {role !== 'admin' && (
          <button className={styles.iconBtn} aria-label="Notifications">
            <i className="ti ti-bell" aria-hidden="true" />
          </button>
        )}

        <div className={styles.avatar} style={{ background: primaryColor + '18', borderColor: primaryColor + '40', color: primaryColor }}>
          {client?.name?.split(' ').map(w => w[0]).join('').slice(0,2) || 'GM'}
        </div>
      </div>

      {toast && (
        <div className={styles.toast} style={{ borderColor: primaryColor + '55', color: primaryColor }}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </header>
  )
}



