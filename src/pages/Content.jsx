import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import {
  getDownloadLink, getPreviewLink, uploadFile, deleteFile,
  createFolder, deleteFolder, getFileType, formatBytes, formatDate
} from '../lib/dropbox'
import { logAction } from '../lib/audit'
import { supabase } from '../lib/supabase'
import styles from './Content.module.css'

async function listDropboxFolder(path) {
  const res = await fetch('/api/dropbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'files/list_folder',
      body: { path, include_deleted: false }
    })
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.entries || []
}

export default function Content() {
  const { client, role, loadUserContext } = useClient()
  const clientName = client?.name || 'Glowing Moon Media'
  const ROOT = `/Glowing Moon Portal/2026/${clientName}/Content`

  const [stack, setStack] = useState([{ name: 'Content', path: ROOT }])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [newFolderModal, setNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [commentModal, setCommentModal] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [approving, setApproving] = useState(false)
  const [localStatus, setLocalStatus] = useState(null)
  const fileRef = useRef()

  const currentPath = stack[stack.length - 1].path
  const approvalStatus = localStatus ?? client?.approval_status
  const isPending = approvalStatus === 'pending'
  const approvalMonth = client?.approval_month

  useEffect(() => {
    loadFolder(currentPath)
  }, [currentPath])

  async function loadFolder(path) {
    setLoading(true)
    setEntries([])
    const raw = await listDropboxFolder(path)
    const folders = raw.filter(e => e['.tag'] === 'folder')
    const files = raw.filter(e => e['.tag'] === 'file')
    const filesWithUrls = await Promise.all(files.map(async file => {
      const type = getFileType(file.name)
      let url = null
      if (type === 'photo' || type === 'video') {
        url = await getPreviewLink(file.path_lower)
      }
      return { ...file, type, url }
    }))
    setEntries([...folders.map(f => ({ ...f, type: 'folder' })), ...filesWithUrls])
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
  }

  async function handleDeleteFile(file) {
    await deleteFile(file.path_lower)
    await logAction('delete', 'content', { fileName: file.name, path: file.path_lower })
    setEntries(prev => prev.filter(e => e.id !== file.id))
  }

  async function handleDeleteFolder(folder) {
    await deleteFolder(folder.path_lower)
    setEntries(prev => prev.filter(e => e.id !== folder.id))
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    await createFolder(`${currentPath}/${newFolderName.trim()}`)
    setNewFolderName('')
    setNewFolderModal(false)
    await loadFolder(currentPath)
  }

  async function handleDownload(file) {
    const link = await getDownloadLink(file.path_lower)
    if (link) {
      window.open(link, '_blank')
      await logAction('download', 'content', { fileName: file.name, path: file.path_lower })
    }
  }

  async function submitComment() {
    if (!commentText.trim() || !commentModal) return
    setSubmittingComment(true)
    await supabase.from('file_comments').insert({
      client_id: client.id,
      file_path: commentModal.path_lower,
      comment: commentText.trim()
    })
    await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'comment',
        clientName: client.name,
        fileName: commentModal.name,
        comment: commentText.trim()
      })
    })
    setCommentText('')
    setCommentModal(null)
    setSubmittingComment(false)
  }

  async function handleApprove() {
    setApproving(true)
    try {
      await supabase.from('clients').update({
        approval_status: 'approved'
      }).eq('id', client.id)

      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approved',
          clientName: client.name,
          month: approvalMonth
        })
      })

      setLocalStatus('approved')
    } catch(err) {
      console.error('Approve error:', err)
    }
    setApproving(false)
  }

  const folders = entries.filter(e => e.type === 'folder')
  const photos = entries.filter(e => e.type === 'photo')
  const videos = entries.filter(e => e.type === 'video')
  const others = entries.filter(e => e.type !== 'folder' && e.type !== 'photo' && e.type !== 'video')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Library</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            {stack.map((crumb, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {i < stack.length - 1 ? (
                  <button
                    onClick={() => goBack(i)}
                    style={{ background: 'none', border: 'none', color: 'var(--gold-light)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
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
        {role === 'admin' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-gold" onClick={() => setNewFolderModal(true)}>
              <i className="ti ti-folder-plus" /> New Folder
            </button>
            <input type="file" ref={fileRef} style={{ display: 'none' }} multiple accept="image/*,video/*" onChange={handleUpload} />
            <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
              <i className="ti ti-upload" /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        )}
      </div>

      {isPending && (
        <div style={{
          background: 'var(--gold-bg)',
          border: '1px solid var(--gold-border)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap'
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gold-light)', marginBottom: '4px' }}>
              {approvalMonth} content is ready for your review
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
              Leave a comment on any file that needs changes, then approve when everything looks good.
            </div>
          </div>
          <button
            className="btn btn-gold"
            onClick={handleApprove}
            disabled={approving}
            style={{ whiteSpace: 'nowrap' }}
          >
            <i className="ti ti-circle-check" /> {approving ? 'Approving...' : `Approve ${approvalMonth}`}
          </button>
        </div>
      )}

      {approvalStatus === 'approved' && (
        <div style={{
          background: 'var(--teal-bg)',
          border: '1px solid var(--teal)',
          borderRadius: '10px',
          padding: '12px 20px',
          marginBottom: '24px',
          fontSize: '13px',
          color: 'var(--teal)'
        }}>
          <i className="ti ti-circle-check" /> {approvalMonth} content approved
        </div>
      )}

      {loading && <div className={styles.emptyState}>Loading...</div>}

      {!loading && entries.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-folder-off" style={{ fontSize: '36px', color: 'var(--text3)', marginBottom: '12px' }} />
          <div style={{ fontSize: '14px', color: 'var(--text2)' }}>This folder is empty</div>
        </div>
      )}

      {folders.length > 0 && (
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

      {photos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Photos ({photos.length})</div>
          <div className={styles.mediaGrid}>
            {photos.map(f => (
              <div key={f.id} className={styles.thumb} onClick={() => setLightbox(f)}>
                <div className={styles.thumbImgWrap}>
                  {f.url
                    ? <img src={f.url} alt={f.name} className={styles.thumbImg} onError={e => { e.target.style.display = 'none' }} />
                    : <div className={styles.thumbFallback}><i className="ti ti-photo" style={{ fontSize: '28px', color: 'var(--teal)' }} /></div>
                  }
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                    {isPending && role === 'member' && (
                      <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); setCommentModal(f); setCommentText('') }} title="Request revision">
                        <i className="ti ti-message" />
                      </button>
                    )}
                    {role === 'admin' && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
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
                    : <div className={styles.thumbFallback}><i className="ti ti-video" style={{ fontSize: '28px', color: 'var(--gold-light)' }} /></div>
                  }
                  <div className={styles.playBadge}><i className="ti ti-player-play" /></div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                    {isPending && role === 'member' && (
                      <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); setCommentModal(f); setCommentText('') }} title="Request revision">
                        <i className="ti ti-message" />
                      </button>
                    )}
                    {role === 'admin' && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
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
                  <div className={styles.thumbFallback}><i className="ti ti-file" style={{ fontSize: '28px', color: 'var(--text3)' }} /></div>
                </div>
                <div className={styles.thumbFooter}>
                  <div className={styles.thumbLabel}>{f.name}</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className={styles.thumbActionBtn} onClick={() => handleDownload(f)}><i className="ti ti-download" /></button>
                    {isPending && role === 'member' && (
                      <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); setCommentModal(f); setCommentText('') }} title="Request revision">
                        <i className="ti ti-message" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
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
                placeholder="e.g. July 2026, Brand Shoot"
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setNewFolderModal(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create Folder</button>
            </div>
          </div>
        </div>
      )}

      {commentModal && (
        <div className={styles.overlay} onClick={() => setCommentModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Request Revision</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '16px' }}>{commentModal.name}</div>
            <div className={styles.field}>
              <label className={styles.label}>What needs to change?</label>
              <textarea
                className={styles.input}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Describe the revision you need..."
                rows={4}
                style={{ resize: 'vertical' }}
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setCommentModal(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={submitComment} disabled={submittingComment || !commentText.trim()}>
                {submittingComment ? 'Sending...' : 'Send Revision Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <div className={styles.lightboxInner} onClick={e => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setLightbox(null)}><i className="ti ti-x" /></button>
            {lightbox.type === 'photo'
              ? <img src={lightbox.url} alt={lightbox.name} className={styles.lightboxMedia} />
              : <video src={lightbox.url} controls className={styles.lightboxMedia} autoPlay />
            }
            <div className={styles.lightboxActions}>
              <div className={styles.lightboxName}>{lightbox.name}</div>
              <button className="btn btn-gold" onClick={() => handleDownload(lightbox)}><i className="ti ti-download" /> Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
