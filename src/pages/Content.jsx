import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import {
  getClientYears, getContentFolders, getContentFiles,
  getDownloadLink, getPreviewLink, uploadFile, deleteFile,
  createFolder, deleteFolder, getFileType, formatBytes, formatDate
} from '../lib/dropbox'
import styles from './Content.module.css'

const BASE_PATH = '/Glowing Moon Portal'

export default function Content() {
  const { client, role } = useClient()
  const clientName = client?.name || 'Glowing Moon Media'

  const [years, setYears] = useState([])
  const [activeYear, setActiveYear] = useState(null)
  const [folders, setFolders] = useState([])
  const [activeFolder, setActiveFolder] = useState(null)
  const [files, setFiles] = useState([])
  const [loadingYears, setLoadingYears] = useState(true)
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [newFolderModal, setNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const fileRef = useRef()

  useEffect(() => { if (clientName) loadYears() }, [clientName])

  async function loadYears() {
    setLoadingYears(true)
    const y = await getClientYears(clientName)
    setYears(y)
    if (y.length > 0) {
      setActiveYear(y[0])
      loadFolders(y[0])
    }
    setLoadingYears(false)
  }

  async function loadFolders(year) {
    setLoadingFolders(true)
    setFolders([])
    setActiveFolder(null)
    setFiles([])
    const f = await getContentFolders(clientName, year)
    setFolders(f)
    setLoadingFolders(false)
  }

  async function openFolder(folder) {
    setActiveFolder(folder)
    setLoadingFiles(true)
    setFiles([])
    const f = await getContentFiles(clientName, activeYear, folder.name)
    // Get preview URLs for images/videos (batch up to 10 at a time)
    const withUrls = await Promise.all(f.map(async file => {
      const type = getFileType(file.name)
      let url = null
      if (type === 'photo' || type === 'video') {
        url = await getPreviewLink(file.path_lower)
      }
      return { ...file, type, url }
    }))
    setFiles(withUrls)
    setLoadingFiles(false)
  }

  async function handleUpload(e) {
    if (!activeFolder || !activeYear) return
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    setUploading(true)
    for (const file of selected) {
      const path = `${BASE_PATH}/${activeYear}/${clientName}/Content/${activeFolder.name}/${file.name}`
      const arrayBuffer = await file.arrayBuffer()
      await uploadFile(path, arrayBuffer)
    }
    await openFolder(activeFolder)
    setUploading(false)
  }

  async function handleDeleteFile(file) {
    await deleteFile(file.path_lower)
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !activeYear) return
    const path = `${BASE_PATH}/${activeYear}/${clientName}/Content/${newFolderName.trim()}`
    await createFolder(path)
    setNewFolderName('')
    setNewFolderModal(false)
    await loadFolders(activeYear)
  }

  async function handleDeleteFolder(folder) {
    await deleteFolder(folder.path_lower)
    if (activeFolder?.id === folder.id) setActiveFolder(null)
    await loadFolders(activeYear)
  }

  async function handleDownload(file) {
    const link = await getDownloadLink(file.path_lower)
    if (link) window.open(link, '_blank')
  }

  const photos = files.filter(f => f.type === 'photo')
  const videos = files.filter(f => f.type === 'video')
  const others = files.filter(f => f.type !== 'photo' && f.type !== 'video')

  if (loadingYears) return (
    <div className={styles.page}>
      <div className={styles.emptyState}>Loading your content library...</div>
    </div>
  )

  if (years.length === 0) return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Content Library</h1>
        <p className={styles.sub}>No content years found in Dropbox yet</p>
      </div>
      <div className={styles.emptyState}>
        <i className="ti ti-brand-dropbox" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} />
        <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No content found</div>
        <div style={{ fontSize:'12px', color:'var(--text3)' }}>
          Add a year folder to your Dropbox at:<br/>
          <code style={{ color:'var(--gold-light)', fontSize:'11px' }}>Glowing Moon Portal / 2026 / {clientName} / Content</code>
        </div>
      </div>
    </div>
  )

  // FOLDER LIST VIEW
  if (!activeFolder) return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Library</h1>
          <p className={styles.sub}>Photos and videos organised by campaign and year</p>
        </div>
        {role === 'admin' && (
          <button className="btn btn-gold" onClick={() => setNewFolderModal(true)}>
            <i className="ti ti-folder-plus" /> New Folder
          </button>
        )}
      </div>

      {/* Year tabs */}
      <div className={styles.yearTabs}>
        {years.map(y => (
          <button
            key={y}
            className={`${styles.yearTab} ${activeYear === y ? styles.yearTabActive : ''}`}
            onClick={() => { setActiveYear(y); loadFolders(y) }}
          >
            {y}
          </button>
        ))}
      </div>

      {loadingFolders && <div className={styles.emptyState}>Loading folders...</div>}

      {!loadingFolders && folders.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-folder-off" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} />
          <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No folders yet for {activeYear}</div>
          <div style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'16px' }}>
            Create a folder in Dropbox at:<br/>
            <code style={{ color:'var(--gold-light)', fontSize:'11px' }}>Glowing Moon Portal / {activeYear} / {clientName} / Content</code>
          </div>
          {role === 'admin' && (
            <button className="btn btn-gold" onClick={() => setNewFolderModal(true)}>
              <i className="ti ti-folder-plus" /> Create First Folder
            </button>
          )}
        </div>
      )}

      {!loadingFolders && folders.length > 0 && (
        <div className={styles.folderGrid}>
          {folders.map(f => (
            <div key={f.id} className={styles.folderCard}>
              <div className={styles.folderCardInner} onClick={() => openFolder(f)}>
                <div className={styles.folderIconWrap}>
                  <i className="ti ti-folder-filled" />
                </div>
                <div className={styles.folderName}>{f.name}</div>
                <div className={styles.folderCount}>Click to browse</div>
              </div>
              {role === 'admin' && (
                <button
                  className={styles.folderDelete}
                  onClick={e => { e.stopPropagation(); handleDeleteFolder(f) }}
                  title="Delete folder"
                >
                  <i className="ti ti-trash" />
                </button>
              )}
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
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                placeholder="e.g. May Campaign, Brand Shoot"
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setNewFolderModal(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                Create Folder
              </button>
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
            <i className="ti ti-arrow-left" /> All Folders
          </button>
          <h1 className={styles.title}>{activeFolder.name}</h1>
          <p className={styles.sub}>{activeYear} · {clientName}</p>
        </div>
        {role === 'admin' && (
          <div>
            <input type="file" ref={fileRef} style={{ display:'none' }} multiple accept="image/*,video/*" onChange={handleUpload} />
            <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
              <i className="ti ti-upload" /> {uploading ? 'Uploading...' : 'Upload Files'}
            </button>
          </div>
        )}
      </div>

      {loadingFiles && (
        <div className={styles.emptyState}>
          <i className="ti ti-loader" style={{ fontSize:'28px', color:'var(--text3)', marginBottom:'8px' }} />
          Loading files from Dropbox...
        </div>
      )}

      {!loadingFiles && files.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-photo-off" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} />
          <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No files in this folder yet</div>
          <div style={{ fontSize:'12px', color:'var(--text3)' }}>
            {role === 'admin' ? 'Upload files above or add them directly in Dropbox' : 'Check back soon — your content is on the way'}
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Photos ({photos.length})</div>
          <div className={styles.mediaGrid}>
            {photos.map(f => (
              <div key={f.id} className={styles.thumb} onClick={() => setLightbox(f)}>
                <div className={styles.thumbImgWrap}>
                  {f.url
                    ? <img src={f.url} alt={f.name} className={styles.thumbImg}
                        onError={e => { e.target.style.display='none' }}
                      />
                    : <div className={styles.thumbFallback}>
                        <i className="ti ti-photo" style={{ fontSize:'28px', color:'var(--teal)' }} />
                      </div>
                  }
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <div style={{ display:'flex', gap:'4px' }}>
                    <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }} title="Download">
                      <i className="ti ti-download" />
                    </button>
                    {role === 'admin' && (
                      <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }} title="Delete">
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
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
              <div key={f.id} className={styles.thumb} onClick={() => setLightbox(f)}>
                <div className={styles.thumbImgWrap}>
                  {f.url
                    ? <video src={f.url} className={styles.thumbImg} preload="metadata" muted />
                    : <div className={styles.thumbFallback}>
                        <i className="ti ti-video" style={{ fontSize:'28px', color:'var(--gold-light)' }} />
                      </div>
                  }
                  <div className={styles.playBadge}><i className="ti ti-player-play" /></div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <div style={{ display:'flex', gap:'4px' }}>
                    <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }} title="Download">
                      <i className="ti ti-download" />
                    </button>
                    {role === 'admin' && (
                      <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }} title="Delete">
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
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
              <div key={f.id} className={styles.thumb}>
                <div className={styles.thumbImgWrap}>
                  <div className={styles.thumbFallback}>
                    <i className="ti ti-file" style={{ fontSize:'28px', color:'var(--text3)' }} />
                  </div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <button className={styles.thumbActionBtn} onClick={() => handleDownload(f)} title="Download">
                    <i className="ti ti-download" />
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
              <i className="ti ti-x" />
            </button>
            {lightbox.type === 'photo'
              ? <img src={lightbox.url} alt={lightbox.name} className={styles.lightboxMedia} />
              : <video src={lightbox.url} controls className={styles.lightboxMedia} autoPlay />
            }
            <div className={styles.lightboxActions}>
              <div className={styles.lightboxName}>{lightbox.name}</div>
              <button className="btn btn-gold" onClick={() => handleDownload(lightbox)}>
                <i className="ti ti-download" /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
