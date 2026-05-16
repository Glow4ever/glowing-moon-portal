import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Topbar.module.css'

export default function Topbar({ clientName = 'Glowing Moon Media' }) {
  const [logoUrl, setLogoUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState(false)
  const fileRef = useRef()

  async function handleLogoUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `logos/client-logo.${ext}`
    const { error } = await supabase.storage
      .from('portal-assets')
      .upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      setLogoUrl(data.publicUrl + '?t=' + Date.now())
      setToast(true)
      setTimeout(() => setToast(false), 2500)
    }
    setUploading(false)
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.logo} onClick={() => fileRef.current.click()} title="Click to update logo">
        <input type="file" ref={fileRef} accept="image/*" style={{ display:'none' }} onChange={handleLogoUpload} />
        <div className={styles.logoCircle}>
          {logoUrl
            ? <img src={logoUrl} alt="Logo" className={styles.logoImg} />
            : <span className={styles.logoInitials}>GM</span>
          }
          <div className={styles.logoOverlay}>
            <i className={`ti ${uploading ? 'ti-loader' : 'ti-camera'}`} aria-hidden="true" />
          </div>
        </div>
        <div className={styles.logoText}>Glowing Moon Media</div>
        <div className={styles.logoHint}>
          <i className="ti ti-upload" style={{ fontSize:'9px' }} aria-hidden="true" /> Click to update logo
        </div>
      </div>

      <div className={styles.center}>
        <span>Client Portal</span>
        <span className={styles.dot}>·</span>
        <div className={styles.pill}>{clientName}</div>
      </div>

      <div className={styles.right}>
        <button className={styles.iconBtn} aria-label="Notifications">
          <i className="ti ti-bell" aria-hidden="true" />
        </button>
        <div className={styles.avatar}>GM</div>
      </div>

      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> Logo updated!
        </div>
      )}
    </header>
  )
}
