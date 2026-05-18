import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import {
  getClientYears, getAssetFolders, getAssetFiles,
  getDownloadLink, uploadFile, deleteFile, getFileType, formatBytes, formatDate
} from '../lib/dropbox'
import styles from './Assets.module.css'

const BASE_PATH = '/Glowing Moon Portal'

const FOLDER_ICONS = {
  'Brand Guidelines': { icon: 'ti-palette', color: 'var(--gold-light)', bg: 'var(--gold-bg)' },
  'Branding Assets':  { icon: 'ti-brand-figma', color: 'var(--teal)', bg: 'var(--teal-bg)' },
  'Planning Docs':    { icon: 'ti-file-text', color: 'var(--text2)', bg: 'rgba(255,255,255,0.05)' },
  'Reports':          { icon: 'ti-chart-bar', color: 'var(--text3)', bg: 'rgba(255,255,255,0.04)' },
  'Templates':        { icon: 'ti-template', color: 'var(--coral)', bg: 'var(--coral-bg)' },
}

function getIconForFolder(name) {
  return FOLDER_ICONS[name] || { icon: 'ti-folder', color: 'var(--gold-light)', bg: 'var(--gold-bg)' }
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (ext === 'pdf') return { icon: 'ti-file-type-pdf', bg: 'var(--coral-bg)', color: 'var(--coral)' }
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return { icon: 'ti-photo', bg: 'var(--teal-bg)', color: 'var(--teal)' }
  if (['mp4','mov','avi'].includes(ext)) return { icon: 'ti-video', bg: 'var(--gold-bg)', color: 'var(--gold-light)' }
  if (['zip','rar'].includes(ext)) return { icon: 'ti-file-zip', bg: 'rgba(255,255,255,0.05)', color: 'var(--text2)' }
  return { icon: 'ti-file', bg: 'rgba(255,255,255,0.05)', color: 'var(--text2)' }
}

export default function Assets() {
  const { client, role } = useClient()
  const clientName = client?.name || 'Glowing Moon Media'

  const [years, setYears] = useState([])
  const [activeYear, setActiveYear] = useState(null)
  const [folders, setFolders] = useState([])
  const [activeFolder, setActiveFolder] = useState(null)
  const [files, setFiles] = useState([])
  const [folderCounts, setFolderCounts] = useState({})
  const [loadingYears, setLoadingYears] = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
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
    const f = await getAssetFolders(clientName, year)
    setFolders(f)
    // Load counts
    const counts = {}
    await Promise.all(f.map(async folder => {
      const files = await getAssetFiles(clientName, year, folder.name)
      counts[folder.name] = files.length
    }))
    setFolderCounts(counts)
  }

  async function openFolder(folder) {
    setActiveFolder(folder)
    setLoadingFiles(true)
    setFiles([])
    const f = await getAssetFiles(clientName, activeYear, folder.name)
    setFiles(f)
    setLoadingFiles(false)
  }

  async function handleUpload(e) {
    if (!activeFolder || !activeYear) return
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const path = `${BASE_PATH}/${activeYear}/${clientName}/Assets/${activeFolder.name}/${file.name}`
    const arrayBuffer = await file.arrayBuffer()
    await uploadFile(path, arrayBuffer)
    await openFolder(activeFolder)
    setUploading(false)
  }

  async function handleDownload(file) {
    const link = await getDownloadLink(file.path_lower)
    if (link) window.open(link, '_blank')
  }

  async function handleDeleteFile(file) {
    await deleteFile(file.path_lower)
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }

  if (loadingYears) return (
    <div className={styles.page}>
      <div className={styles.empty}>Loading asset library...</div>
    </div>
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          {activeFolder
            ? <>
                <button className={styles.backBtn} onClick={() => setActiveFolder(null)}>
                  <i className="ti ti-arrow-left" /> All Folders
                </button>
                <h1 className={styles.title}>{activeFolder.name}</h1>
                <p className={styles.sub}>{activeYear} · {clientName}</p>
              </>
            : <>
                <h1 className={styles.title}>Asset Library</h1>
                <p className={styles.sub}>Brand files, templates, and strategic documents</p>
              </>
          }
        </div>
        {activeFolder && role === 'admin' && (
          <div>
            <input type="file" ref={fileRef} style={{ display:'none' }} onChange={handleUpload} />
            <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
              <i className="ti ti-upload" /> {uploading ? 'Uploading...' : 'Upload File'}
            </button>
          </div>
        )}
      </div>

      {/* Year tabs */}
      {!activeFolder && years.length > 1 && (
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
      )}

      {!activeFolder ? (
        <div className={styles.folderGrid}>
          {folders.map(f => {
            const iconInfo = getIconForFolder(f.name)
            return (
              <div key={f.id} className={styles.folderCard} onClick={() => openFolder(f)}>
                <div className={styles.folderIcon} style={{ background: iconInfo.bg, color: iconInfo.color }}>
                  <i className={`ti ${iconInfo.icon}`} />
                </div>
                <div className={styles.folderName}>{f.name}</div>
                <div className={styles.folderCount}>{folderCounts[f.name] ?? 0} files</div>
              </div>
            )
          })}
          {folders.length === 0 && (
            <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'48px', color:'var(--text3)', fontSize:'13px' }}>
              No asset folders found in Dropbox for {activeYear}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.fileList}>
          <div className={styles.fileListHeader}>
            <span>Name</span><span>Type</span><span>Date</span><span>Size</span>
          </div>
          {loadingFiles && <div className={styles.empty}>Loading files...</div>}
          {!loadingFiles && files.length === 0 && (
            <div className={styles.empty}>
              <i className="ti ti-folder-open" style={{ fontSize:'28px', color:'var(--text3)', marginBottom:'8px' }} />
              <div>No files yet — {role === 'admin' ? 'upload your first file above' : 'check back soon'}</div>
            </div>
          )}
          {files.map(file => {
            const fi = fileIcon(file.name)
            const ext = file.name.split('.').pop().toUpperCase()
            return (
              <div key={file.id} className={styles.fileRow} onClick={() => handleDownload(file)}>
                <div className={styles.fileName}>
                  <div className={styles.fileIcon} style={{ background: fi.bg, color: fi.color }}>
                    <i className={`ti ${fi.icon}`} />
                  </div>
                  {file.name}
                </div>
                <div className={styles.fileType}>{ext}</div>
                <div className={styles.fileDate}>{formatDate(file.client_modified)}</div>
                <div className={styles.fileSize}>
                  {formatBytes(file.size)}
                  <i className="ti ti-download" style={{ fontSize:'13px', color:'var(--text3)', marginLeft:'6px' }} />
                  {role === 'admin' && (
                    <i className="ti ti-trash" style={{ fontSize:'13px', color:'var(--text3)', marginLeft:'6px', cursor:'pointer' }}
                      onClick={e => { e.stopPropagation(); handleDeleteFile(file) }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
