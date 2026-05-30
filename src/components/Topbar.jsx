import { useRef, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useClient } from '../lib/ClientContext'
import styles from './Topbar.module.css'

export default function Topbar() {
  const { client, role, allClients, switchClient } = useClient()
  const [logoUrl, setLogoUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [showSwitcher, setShowSwitcher] = useState(false)
  const fileRef = useRef()

  const primaryColor = client?.primary_color || '#c9a84c'
  const logoPath = `logos/${client?.slug}-logo`

  useEffect(() => {
    if (client?.slug) loadLogo()
  }, [client])

  async function loadLogo() {
    const extensions = ['png', 'jpg', 'jpeg', 'svg', 'webp']
    for (const ext of extensions) {
      const { data } = supabase.storage
        .from('portal-assets')
        .getPublicUrl(`${logoPath}.${ext}`)
      const res = await fetch(data.publicUrl, { method: 'HEAD' }).catch(() => null)
      if (res?.ok) {
        setLogoUrl(data.publicUrl + '?t=' + Date.now())
        return
      }
    }
    setLogoUrl(null)
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
    setUploading(false)
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
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          borderRadius: '50%',
          padding: '4px'
        }}
      />
    : <span className={styles.logoInitials} style={{ color: primaryColor }}>
        {client?.name?.split(' ').map(w => w[0]).join('').slice(0,2) || 'GM'}
      </span>
  }
  {logoUrl && role === 'admin' && (
    <button
      onClick={handleLogoDelete}
      style={{
        position: 'absolute',
        top: '-6px',
        right: '-6px',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: '#e0845a',
        border: 'none',
        color: 'white',
        fontSize: '9px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 10
      }}
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
        {role === 'admin' && allClients.length > 1 && (
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
        <button className={styles.iconBtn} aria-label="Notifications">
          <i className="ti ti-bell" aria-hidden="true" />
        </button>
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
