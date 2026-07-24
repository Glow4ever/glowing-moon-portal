import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import {
  getDownloadLink, uploadFile, deleteFile, getFileType, formatBytes, formatDate
} from '../lib/dropbox'
import styles from './Assets.module.css'
import { logAction } from '../lib/audit'
import { incrementFileCount } from '../lib/fileCounts'
import { apiFetch } from '../lib/apiFetch'

async function listDropboxFolder(path) {
  const res = await apiFetch('/api/dropbox', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: 'files/list_folder',
      body: { path, include_deleted: false }
    })
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.entries || []
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
  const ROOT = `/Glowing Moon Portal/${clientName}/Assets`

  const [stack, setStack] = useState([{ name: 'Assets', path: ROOT }])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  const currentPath = stack[stack.length - 1].path

  useEffect(() => {
    loadFolder(currentPath)
  }, [currentPath])

  async function loadFolder(path) {
    setLoading(true)
    setEntries([])
    const raw = await listDropboxFolder(path)
    const folders = raw.filter(e => e['.tag'] === 'folder')
    const files = raw.filter(e => e['.tag'] === 'file')
    setEntries([
      ...folders.map(f => ({ ...f, type: 'folder' })),
      ...files.map(f => ({ ...f, type: getFileType(f.name) }))
    ])
    setLoading(false)
  }

  function openFolder(folder) {
    setStack(prev => [...prev, { name: folder.name, path: folder.path_lower }])
  }

  function goBack(index) {
    setStack(prev => prev.slice(0, index + 1))
  }

  async function handleUpload(e) {
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    setUploading(true)
    for (const file of selected) {
      const arrayBuffer = await file.arrayBuffer()
      await uploadFile(`${currentPath}/${file.name}`, arrayBuffer)
    }
    await loadFolder(currentPath)
    setUploading(false)
    if (client?.id) incrementFileCount(client.id, 'asset', selected.length)
  }

  async function handleDownload(file) {
    const link = await getDownloadLink(file.path_lower)
    if (link) {
      window.open(link, '_blank')
      await logAction('download', 'assets', { fileName: file.name, path: file.path_lower })
    }
  }

  async function handleDeleteFile(file) {
    await deleteFile(file.path_lower)
    await logAction('delete', 'assets', { fileName: file.name, path: file.path_lower })
    setEntries(prev => prev.filter(e => e.id !== file.id))
    if (client?.id) incrementFileCount(client.id, 'asset', -1)
  }

  const folders = entries.filter(e => e.type === 'folder')
  const files = entries.filter(e => e.type !== 'folder')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Asset Library</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            {stack.map((crumb, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {i < stack.length - 1 ? (
                  <button
                    onClick={() => goBack(i)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--gold-light)',
                      cursor: 'pointer', fontSize: '13px', padding: 0
                    }}
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <span style={{ color: 'var(--text1)', fontSize: '13px' }}>{crumb.name}</span>
                )}
                {i < stack.length - 1 && (
                  <span style={{ color: 'var(--text3)', fontSize: '12px' }}>›</span>
                )}
              </span>
            ))}
          </div>
        </div>
        {(role === 'admin' || role === 'editor') && (
          <div>
            <input type="file" ref={fileRef} style={{ display: 'none' }} multiple onChange={handleUpload} />
            <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
              <i className="ti ti-upload" /> {uploading ? 'Uploading...' : 'Upload File'}
            </button>
          </div>
        )}
      </div>

      {loading && <div className={styles.empty}>Loading asset library...</div>}

      {!loading && entries.length === 0 && (
        <div className={styles.empty}>
          <i className="ti ti-folder-off" style={{ fontSize: '36px', color: 'var(--text3)', marginBottom: '12px' }} />
          <div style={{ fontSize: '14px', color: 'var(--text2)' }}>This folder is empty</div>
        </div>
      )}

      {folders.length > 0 && (
        <div className={styles.folderGrid}>
          {folders.map(f => (
            <div key={f.id} className={styles.folderCard} onClick={() => openFolder(f)}>
              <div className={styles.folderIcon} style={{ background: 'var(--gold-bg)', color: 'var(--gold-light)' }}>
                <i className="ti ti-folder-filled" />
              </div>
              <div className={styles.folderName}>{f.name}</div>
              <div className={styles.folderCount}>Click to browse</div>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.fileList}>
          <div className={styles.fileListHeader}>
            <span>Name</span><span>Type</span><span>Date</span><span>Size</span>
          </div>
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
                  {file.client_modified && (Date.now() - new Date(file.client_modified).getTime() < 7 * 24 * 60 * 60 * 1000) && (
                    <span style={{ background: 'var(--gold-light)', color: '#0E0E0F', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', padding: '2px 7px', borderRadius: '20px', marginLeft: '8px' }}>
                      NEW
                    </span>
                  )}
                </div>
                <div className={styles.fileType}>{ext}</div>
                <div className={styles.fileDate}>{formatDate(file.client_modified)}</div>
                <div className={styles.fileSize}>
                  {formatBytes(file.size)}
                  <i className="ti ti-download" style={{ fontSize: '13px', color: 'var(--text3)', marginLeft: '6px' }} />
                  {(role === 'admin' || role === 'editor') && (
                    <i className="ti ti-trash"
                      style={{ fontSize: '13px', color: 'var(--text3)', marginLeft: '6px', cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); handleDeleteFile(file) }}
                    />
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


