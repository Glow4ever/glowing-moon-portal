import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Content.module.css'

function fileType(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['mp4','mov','avi','webm'].includes(ext)) return 'video'
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'photo'
  return 'other'
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export default function Content() {
  const [folders, setFolders] = useState([])
  const [activeFolder, setActiveFolder] = useState(null)
  const [files, setFiles] = useState([])
  const [loadingFolders, setLoadingFolders] = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [newFolderModal, setNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [deletingFolder, setDeletingFolder] = useState(null)
  const fileRef = useRef()

  useEffect(() => { loadFolders() }, [])

  async function loadFolders() {
    setLoadingFolders(true)
    const { data, error } = await supabase.storage.from('portal-assets').list('content')
    if (!error && data) {
      const real = data.filter(f => f.id === null)
      const withCounts = await Promise.all(real.map(async f => {
        const { data: files } = await supabase.storage.from('portal-assets').list(`content/${f.name}`)
        return { ...f, count: files ? files.filter(x => x.name !== '.keep').length : 0 }
      }))
      setFolders(withCounts)
    }
    setLoadingFolders(false)
  }

  async function createFolder() {
    if (!newFolderName.trim()) return
    const slug = slugify(newFolderName.trim())
    const blob = new Blob([''], { type: 'text/plain' })
    await supabase.storage.from('portal-assets').upload(`content/${slug}/.keep`, blob, { upsert: true })
    setNewFolderName('')
    setNewFolderModal(false)
    await loadFolders()
  }

  async function deleteFolder(folder) {
    setDeletingFolder(folder.name)
    const { data } = await supabase.storage.from('portal-assets').list(`content/${folder.name}`)
    if (data) {
      const paths = data.map(f => `content/${folder.name}/${f.name}`)
      if (paths.length) await supabase.storage.from('portal-assets').remove(paths)
    }
    if (activeFolder?.name === folder.name) setActiveFolder(null)
    setDeletingFolder(null)
    await loadFolders()
  }

  async function openFolder(folder) {
    setActiveFolder(folder)
    setLoadingFiles(true)
    setFiles([])
    const { data, error } = await supabase.storage.from('portal-assets').list(`content/${folder.name}`, {
      sortBy: { column: 'created_at', order: 'desc' }
    })
    if (!error && data) {
      const filtered = data.filter(f => f.name !== '.keep')
      const paths = filtered.map(f => `content/${folder.name}/${f.name}`)
      const { data: signedData } = await supabase.storage
        .from('portal-assets')
        .createSignedUrls(paths, 3600)
      const withUrls = filtered.map((f, i) => ({
        ...f,
        url: signedData?.[i]?.signedUrl || null,
        type: fileType(f.name)
      }))
      setFiles(withUrls)
    }
    setLoadingFiles(false)
  }

  async function handleUpload(e) {
    if (!activeFolder) return
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    setUploading(true)
    for (const file of selected) {
      await supabase.storage.from('portal-assets').upload(`content/${activeFolder.name}/${file.name}`, file, { upsert: true })
    }
    await openFolder(activeFolder)
    setUploading(false)
  }

  async function deleteFile(file) {
    await supabase.storage.from('portal-assets').remove([`content/${activeFolder.name}/${file.name}`])
    setFiles(prev => prev.filter(f => f.name !== file.name))
  }

  const photos = files.filter(f => f.type === 'photo')
  const videos = files.filter(f => f.type === 'video')
  const others = files.filter(f => f.type === 'other')

  // FOLDER LIST VIEW
  if (!activeFolder) return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Library</h1>
          <p className={styles.sub}>Organise your photos and videos into custom folders</p>
        </div>
        <button className="btn btn-gold" onClick={() => setNewFolderModal(true)}>
          <i className="ti ti-folder-plus" aria-hidden="true" /> New Folder
        </button>
      </div>

      {loadingFolders && <div className={styles.emptyState}>Loading folders...</div>}

      {!loadingFolders && folders.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-folder-off" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} aria-hidden="true" />
          <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No folders yet</div>
          <div style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'16px' }}>Create your first folder to start organising content</div>
          <button className="btn btn-gold" onClick={() => setNewFolderModal(true)}>
            <i className="ti ti-folder-plus" aria-hidden="true" /> Create First Folder
          </button>
        </div>
      )}

      {!loadingFolders && folders.length > 0 && (
        <div className={styles.folderGrid}>
          {folders.map(f => (
            <div key={f.name} className={styles.folderCard}>
              <div className={styles.folderCardInner} onClick={() => openFolder(f)}>
                <div className={styles.folderIconWrap}>
                  <svg viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.folderSvg}>
                    <path d="M0 6C0 2.686 2.686 0 6 0H18.764C20.295 0 21.758 0.632 22.816 1.745L26.184 5.255C27.242 6.368 28.705 7 30.236 7H42C45.314 7 48 9.686 48 13V34C48 37.314 45.314 40 42 40H6C2.686 40 0 37.314 0 34V6Z" fill="var(--gold-bg)"/>
                    <path d="M0 13C0 9.686 2.686 7 6 7H42C45.314 7 48 9.686 48 13V34C48 37.314 45.314 40 42 40H6C2.686 40 0 37.314 0 34V13Z" fill="var(--gold)" opacity="0.25"/>
                    <path d="M0 15C0 11.686 2.686 9 6 9H42C45.314 9 48 11.686 48 15V34C48 37.314 45.314 40 42 40H6C2.686 40 0 37.314 0 34V15Z" fill="var(--gold)" opacity="0.35"/>
                  </svg>
                </div>
                <div className={styles.folderName}>{f.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                <div className={styles.folderCount}>{f.count} {f.count === 1 ? 'file' : 'files'}</div>
              </div>
              <button
                className={styles.folderDelete}
                onClick={e => { e.stopPropagation(); deleteFolder(f) }}
                disabled={deletingFolder === f.name}
                title="Delete folder"
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {newFolderModal && (
        <div className={styles.overlay} onClick={() => setNewFolderModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Folder</div>
            <div className={styles.field}>
              <label className={styles.label}>Folder Name</label>
              <input
                className={styles.input}
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()}
                placeholder="e.g. May Campaign, Brand Shoot, Q2 Content"
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setNewFolderModal(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={createFolder} disabled={!newFolderName.trim()}>Create Folder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // FILE VIEW
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <button className={styles.backBtn} onClick={() => setActiveFolder(null)}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> All Folders
          </button>
          <h1 className={styles.title}>
            {activeFolder.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </h1>
        </div>
        <div>
          <input type="file" ref={fileRef} style={{ display:'none' }} multiple accept="image/*,video/*" onChange={handleUpload} />
          <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
            <i className="ti ti-upload" aria-hidden="true" /> {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>
      </div>

      {loadingFiles && (
        <div className={styles.emptyState}>
          <i className="ti ti-loader" style={{ fontSize:'28px', color:'var(--text3)', marginBottom:'8px' }} aria-hidden="true" />
          Loading files...
        </div>
      )}

      {!loadingFiles && files.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-photo-off" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} aria-hidden="true" />
          <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No files in this folder yet</div>
          <div style={{ fontSize:'12px', color:'var(--text3)' }}>Upload photos and videos using the button above</div>
        </div>
      )}

      {photos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Photos ({photos.length})</div>
          <div className={styles.mediaGrid}>
            {photos.map(f => (
              <div key={f.name} className={styles.thumb} onClick={() => setLightbox(f)}>
                <div className={styles.thumbImgWrap}>
                  {f.url
                    ? <img src={f.url} alt={f.name} className={styles.thumbImg}
                        onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }}
                      />
                    : null
                  }
                  <div className={styles.thumbFallback} style={{ display: f.url ? 'none' : 'flex' }}>
                    <i className="ti ti-photo" style={{ fontSize:'28px', color:'var(--teal)' }} aria-hidden="true" />
                  </div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); deleteFile(f) }} title="Delete">
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Videos & Reels ({videos.length})</div>
          <div className={styles.mediaGrid}>
            {videos.map(f => (
              <div key={f.name} className={styles.thumb} onClick={() => setLightbox(f)}>
                <div className={styles.thumbImgWrap}>
                  {f.url
                    ? <video src={f.url} className={styles.thumbImg} preload="metadata" muted />
                    : null
                  }
                  <div className={styles.thumbFallback} style={{ display: f.url ? 'none' : 'flex' }}>
                    <i className="ti ti-video" style={{ fontSize:'28px', color:'var(--gold-light)' }} aria-hidden="true" />
                  </div>
                  <div className={styles.playBadge}><i className="ti ti-player-play" aria-hidden="true" /></div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); deleteFile(f) }} title="Delete">
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Other Files ({others.length})</div>
          <div className={styles.mediaGrid}>
            {others.map(f => (
              <div key={f.name} className={styles.thumb} onClick={() => f.url && window.open(f.url, '_blank')}>
                <div className={styles.thumbImgWrap}>
                  <div className={styles.thumbFallback} style={{ display:'flex' }}>
                    <i className="ti ti-file" style={{ fontSize:'28px', color:'var(--text3)' }} aria-hidden="true" />
                  </div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); deleteFile(f) }} title="Delete">
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <div className={styles.lightboxInner} onClick={e => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
            {lightbox.type === 'photo'
              ? <img src={lightbox.url} alt={lightbox.name} className={styles.lightboxMedia} />
              : <video src={lightbox.url} controls className={styles.lightboxMedia} autoPlay />
            }
            <div className={styles.lightboxName}>{lightbox.name}</div>
          </div>
        </div>
      )}
    </div>
  )
}
