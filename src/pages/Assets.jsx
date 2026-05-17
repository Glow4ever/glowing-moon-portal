import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Assets.module.css'

const folders = [
  { id: 'brand-guidelines', name: 'Brand Guidelines', icon: 'ti-palette',    color: 'var(--gold-light)',  bg: 'var(--gold-bg)' },
  { id: 'canva-templates',  name: 'Canva Templates',  icon: 'ti-template',   color: 'var(--coral)',       bg: 'var(--coral-bg)' },
  { id: 'planning-docs',    name: 'Planning Docs',    icon: 'ti-file-text',  color: 'var(--teal)',        bg: 'var(--teal-bg)' },
  { id: 'design-assets',    name: 'Design Assets',    icon: 'ti-brand-figma',color: 'var(--text2)',       bg: 'rgba(255,255,255,0.05)' },
  { id: 'reports',          name: 'Reports & Analytics', icon: 'ti-chart-bar', color: 'var(--text3)',    bg: 'rgba(255,255,255,0.04)' },
]

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Assets() {
  const [activeFolder, setActiveFolder] = useState(null)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [folderCounts, setFolderCounts] = useState({})
  const fileRef = useRef()

  useEffect(() => {
    folders.forEach(async f => {
      const { data } = await supabase.storage.from('portal-assets').list(`assets/${f.id}`)
      if (data) setFolderCounts(prev => ({ ...prev, [f.id]: data.filter(d => d.name !== '.keep').length }))
    })
  }, [])

  async function openFolder(folder) {
    setActiveFolder(folder)
    setLoading(true)
    const { data, error } = await supabase.storage.from('portal-assets').list(`assets/${folder.id}`, {
      sortBy: { column: 'created_at', order: 'desc' }
    })
    if (!error && data) {
      const filtered = data.filter(f => f.name !== '.keep')
      setFiles(filtered)
    }
    setLoading(false)
  }

  async function handleUpload(e) {
    if (!activeFolder) return
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const path = `assets/${activeFolder.id}/${file.name}`
    await supabase.storage.from('portal-assets').upload(path, file, { upsert: true })
    await openFolder(activeFolder)
    setUploading(false)
  }

  async function handleDownload(file) {
    const { data } = await supabase.storage
      .from('portal-assets')
      .createSignedUrl(`assets/${activeFolder.id}/${file.name}`, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase()
    if (['pdf'].includes(ext)) return { icon: 'ti-file-type-pdf', bg: 'var(--coral-bg)', color: 'var(--coral)' }
    if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return { icon: 'ti-photo', bg: 'var(--teal-bg)', color: 'var(--teal)' }
    if (['mp4','mov','avi'].includes(ext)) return { icon: 'ti-video', bg: 'var(--gold-bg)', color: 'var(--gold-light)' }
    if (['zip','rar'].includes(ext)) return { icon: 'ti-file-zip', bg: 'rgba(255,255,255,0.05)', color: 'var(--text2)' }
    return { icon: 'ti-file', bg: 'rgba(255,255,255,0.05)', color: 'var(--text2)' }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          {activeFolder
            ? <><button className={styles.backBtn} onClick={() => setActiveFolder(null)}><i className="ti ti-arrow-left" aria-hidden="true" /> All Folders</button>
                <h1 className={styles.title}>{activeFolder.name}</h1></>
            : <><h1 className={styles.title}>Asset Library</h1><p className={styles.sub}>Brand files, templates, and strategic documents</p></>
          }
        </div>
        {activeFolder && (
          <div>
            <input type="file" ref={fileRef} style={{ display:'none' }} onChange={handleUpload} />
            <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
              <i className="ti ti-upload" aria-hidden="true" /> {uploading ? 'Uploading...' : 'Upload File'}
            </button>
          </div>
        )}
      </div>

      {!activeFolder ? (
        <div className={styles.folderGrid}>
          {folders.map(f => (
            <div key={f.id} className={styles.folderCard} onClick={() => openFolder(f)}>
              <div className={styles.folderIcon} style={{ background: f.bg, color: f.color }}>
                <i className={`ti ${f.icon}`} aria-hidden="true" />
              </div>
              <div className={styles.folderName}>{f.name}</div>
              <div className={styles.folderCount}>{folderCounts[f.id] ?? 0} files</div>
            </div>
          ))}
          <div className={`${styles.folderCard} ${styles.folderNew}`}>
            <div className={styles.folderIcon} style={{ background: 'transparent', color: 'var(--text3)' }}>
              <i className="ti ti-plus" aria-hidden="true" />
            </div>
            <div className={styles.folderName} style={{ color: 'var(--text3)' }}>New Folder</div>
            <div className={styles.folderCount}>Request via your AM</div>
          </div>
        </div>
      ) : (
        <div className={styles.fileList}>
          <div className={styles.fileListHeader}>
            <span>Name</span><span>Type</span><span>Date</span><span>Size</span>
          </div>
          {loading && <div className={styles.empty}>Loading files...</div>}
          {!loading && files.length === 0 && (
            <div className={styles.empty}>
              <i className="ti ti-folder-open" style={{ fontSize:'28px', color:'var(--text3)', marginBottom:'8px' }} aria-hidden="true" />
              <div>No files yet — upload your first file above</div>
            </div>
          )}
          {files.map(file => {
            const fi = fileIcon(file.name)
            const ext = file.name.split('.').pop().toUpperCase()
            return (
              <div key={file.id} className={styles.fileRow} onClick={() => handleDownload(file)}>
                <div className={styles.fileName}>
                  <div className={styles.fileIcon} style={{ background: fi.bg, color: fi.color }}>
                    <i className={`ti ${fi.icon}`} aria-hidden="true" />
                  </div>
                  {file.name}
                </div>
                <div className={styles.fileType}>{ext}</div>
                <div className={styles.fileDate}>{formatDate(file.created_at)}</div>
                <div className={styles.fileSize}>
                  {formatBytes(file.metadata?.size)}
                  <i className="ti ti-download" style={{ fontSize:'13px', color:'var(--text3)', marginLeft:'6px' }} aria-hidden="true" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
