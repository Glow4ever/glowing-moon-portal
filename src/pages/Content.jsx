import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import {
  getDownloadLink, getPreviewLink, uploadFile, deleteFile,
  createFolder, deleteFolder, getFileType, formatBytes, formatDate
} from '../lib/dropbox'
import { logAction } from '../lib/audit'
import { incrementFileCount, countDropboxFilesRecursive } from '../lib/fileCounts'
import { supabase } from '../lib/supabase'
import styles from './Content.module.css'
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

const STATUS_STYLES = {
  approved:      { bg: 'var(--teal-bg)',  color: 'var(--teal)',       icon: 'ti-check',  label: 'Approved' },
  revision:      { bg: '#2a1a1a',          color: '#F0997B',           icon: 'ti-message', label: 'Revision sent' },
  in_review:     { bg: 'var(--gold-bg)',  color: 'var(--gold-light)', icon: 'ti-eye',     label: 'In review' },
  in_production: { bg: 'rgba(136,135,128,0.14)', color: 'var(--text3)', icon: 'ti-lock',  label: 'In production' }
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.in_review
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: s.bg, color: s.color, fontSize: '11px',
      padding: '3px 8px', borderRadius: '20px'
    }}>
      <i className={`ti ${s.icon}`} style={{ fontSize: '12px' }} aria-hidden="true" />
      {s.label}
    </div>
  )
}

export default function Content() {
  const { client, role, loadUserContext } = useClient()
  const clientName = client?.name || 'Glowing Moon Media'
  const ROOT = `/Glowing Moon Portal/${clientName}/Content`

  const [stack, setStack] = useState(null)

  useEffect(() => {
    if (client) {
      setStack([{ name: 'Content', path: `/Glowing Moon Portal/${client.name}/Content` }])
    }
  }, [client?.name])
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
  const [fileStatuses, setFileStatuses] = useState({})
  const [revisionPaths, setRevisionPaths] = useState({})
  const [bulkApproving, setBulkApproving] = useState(false)
  const [fileApproving, setFileApproving] = useState({})
  const fileRef = useRef()

  const currentPath = stack ? stack[stack.length - 1].path : null
  const approvalStatus = localStatus ?? client?.approval_status
  const isPending = approvalStatus === 'pending'
  const approvalMonth = client?.approval_month

  useEffect(() => {
    if (currentPath) loadFolder(currentPath)
  }, [currentPath])

  useEffect(() => {
    if (client?.id) loadStatusData()
  }, [client?.id])

  async function loadStatusData() {
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('file_path, status').eq('client_id', client.id),
      supabase.from('file_comments').select('file_path').eq('client_id', client.id)
    ])
    const statusMap = {}
    ;(statusRows || []).forEach(r => { statusMap[r.file_path] = r.status })
    setFileStatuses(statusMap)
    const revMap = {}
    ;(commentRows || []).forEach(r => { revMap[r.file_path] = true })
    setRevisionPaths(revMap)
  }

  function getFileDisplayStatus(pathLower) {
    if (revisionPaths[pathLower]) return 'revision'
    if (fileStatuses[pathLower] === 'approved') return 'approved'
    if (fileStatuses[pathLower] === 'in_production') return 'in_production'
    return 'in_review'
  }

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
    if (client?.id) incrementFileCount(client.id, 'content', selected.length)
  }

  async function handleDeleteFile(file) {
    await deleteFile(file.path_lower)
    await logAction('delete', 'content', { fileName: file.name, path: file.path_lower })
    setEntries(prev => prev.filter(e => e.id !== file.id))
    if (client?.id) incrementFileCount(client.id, 'content', -1)
  }

  async function handleDeleteFolder(folder) {
    const filesInFolder = await countDropboxFilesRecursive(folder.path_lower)
    await deleteFolder(folder.path_lower)
    setEntries(prev => prev.filter(e => e.id !== folder.id))
    if (client?.id && filesInFolder > 0) {
      incrementFileCount(client.id, 'content', -filesInFolder)
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    await createFolder(`${currentPath}/${newFolderName.trim()}`)
    setNewFolderName('')
    setNewFolderModal(false)
    await loadFolder(currentPath)
  }

  async function handleDownloadFolder(folder) {
    try {
      const res = await apiFetch('/api/dropbox_zip', {
        method: 'POST',
        body: JSON.stringify({ path: folder.path_display || folder.path_lower })
      })
      if (!res.ok) {
        const err = await res.json()
        console.error('Zip error:', err)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = folder.name + '.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Folder download error:', err)
    }
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
      comment: commentText.trim(),
      read: false
    })
    await apiFetch('/api/send-email', {
      method: 'POST',
      body: JSON.stringify({
        type: 'comment',
        clientName: client.name,
        fileName: commentModal.name,
        comment: commentText.trim()
      })
    })
    setRevisionPaths(prev => ({ ...prev, [commentModal.path_lower]: true }))
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

      await supabase.from('content_months').update({
        approval_status: 'approved'
      }).eq('client_id', client.id).eq('month', client.approval_month?.split(' ')[0]).eq('year', parseInt(client.approval_month?.split(' ')[1]))

      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'approved',
          clientName: client.name,
          month: approvalMonth
        })
      })

      await supabase.from('notifications').insert({
        client_id: client.id,
        type: 'approval',
        message: `${client.name} approved ${approvalMonth} content`
      })

      setLocalStatus('approved')
      await loadUserContext()
    } catch(err) {
      console.error('Approve error:', err)
    }
    setApproving(false)
  }

  async function upsertApproved(files) {
    if (!client?.id || !files.length) return
    const isBulk = files.length > 1
    if (isBulk) setBulkApproving(true)
    else setFileApproving(p => ({ ...p, [files[0].path_lower]: true }))

    const rows = files.map(f => ({
      client_id: client.id,
      file_path: f.path_lower,
      status: 'approved',
      updated_at: new Date().toISOString()
    }))
    const { error } = await supabase.from('file_status').upsert(rows, { onConflict: 'client_id,file_path' })

    if (error) {
      console.error('Approve file error:', error)
      if (isBulk) setBulkApproving(false)
      else setFileApproving(p => ({ ...p, [files[0].path_lower]: false }))
      return
    }

    const nextStatuses = { ...fileStatuses }
    files.forEach(f => { nextStatuses[f.path_lower] = 'approved' })
    setFileStatuses(nextStatuses)

    if (isBulk) setBulkApproving(false)
    else setFileApproving(p => ({ ...p, [files[0].path_lower]: false }))

    const allEntries = entries.filter(e => e.type !== 'folder')
    const allResolved = allEntries.length > 0 && allEntries.every(f => {
      if (revisionPaths[f.path_lower]) return false
      return nextStatuses[f.path_lower] === 'approved'
    })
    if (allResolved && isPending) {
      await handleApprove()
    }
  }

  async function approveFile(file) {
    await upsertApproved([file])
  }

  async function approveAllRemaining() {
    const targets = entries
      .filter(e => e.type !== 'folder')
      .filter(f => getFileDisplayStatus(f.path_lower) === 'in_review')
    if (targets.length) await upsertApproved(targets)
  }

  const folders = entries.filter(e => e.type === 'folder')
  const photos = entries.filter(e => e.type === 'photo')
  const videos = entries.filter(e => e.type === 'video')
  const others = entries.filter(e => e.type !== 'folder' && e.type !== 'photo' && e.type !== 'video')
  const allFiles = [...photos, ...videos, ...others]

  const statusCounts = allFiles.reduce((acc, f) => {
    const s = getFileDisplayStatus(f.path_lower)
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})
  const totalFiles = allFiles.length
  const remainingCount = statusCounts.in_review || 0

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Library</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            {(stack || []).map((crumb, i) => (
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
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '16px', flexWrap: 'wrap', marginBottom: totalFiles > 0 ? '14px' : 0
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gold-light)', marginBottom: '4px' }}>
                {approvalMonth} content is ready for your review
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                Leave a comment on any file that needs changes, then approve the rest in one click.
              </div>
            </div>
            {role === 'member' && remainingCount > 0 && (
              <button
                className="btn btn-gold"
                onClick={approveAllRemaining}
                disabled={bulkApproving}
                style={{ whiteSpace: 'nowrap' }}
              >
                <i className="ti ti-checks" /> {bulkApproving ? 'Approving...' : `Approve all remaining (${remainingCount})`}
              </button>
            )}
          </div>

          {totalFiles > 0 && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {statusCounts.approved > 0 && (
                  <div style={{ background: 'var(--teal-bg)', color: 'var(--teal)', fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}>
                    {statusCounts.approved} approved
                  </div>
                )}
                {statusCounts.in_review > 0 && (
                  <div style={{ background: 'var(--gold-bg)', color: 'var(--gold-light)', fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}>
                    {statusCounts.in_review} in review
                  </div>
                )}
                {statusCounts.revision > 0 && (
                  <div style={{ background: '#2a1a1a', color: '#F0997B', fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}>
                    {statusCounts.revision} revision requested
                  </div>
                )}
                {statusCounts.in_production > 0 && (
                  <div style={{ background: 'rgba(136,135,128,0.14)', color: 'var(--text3)', fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}>
                    {statusCounts.in_production} in production
                  </div>
                )}
              </div>
              <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                {['approved', 'in_review', 'revision', 'in_production'].map(s => (
                  statusCounts[s] > 0 && (
                    <div
                      key={s}
                      style={{
                        width: `${(statusCounts[s] / totalFiles) * 100}%`,
                        background: STATUS_STYLES[s].color
                      }}
                    />
                  )
                ))}
              </div>
            </>
          )}
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
              <div className={styles.folderActions}>
                <button
                  className={styles.folderAction}
                  onClick={e => { e.stopPropagation(); handleDownloadFolder(f) }}
                  title="Download folder as zip"
                >
                  <i className="ti ti-download" />
                </button>
                {role === 'admin' && (
                  <button
                    className={styles.folderAction}
                    onClick={e => { e.stopPropagation(); handleDeleteFolder(f) }}
                    title="Delete folder"
                    style={{ color: 'var(--coral)' }}
                  >
                    <i className="ti ti-trash" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Photos ({photos.length})</div>
          <div className={styles.mediaGrid}>
            {photos.map(f => {
              const status = getFileDisplayStatus(f.path_lower)
              return (
                <div key={f.id} className={styles.thumb} onClick={() => setLightbox(f)}>
                  <div className={styles.thumbImgWrap}>
                    {f.url
                      ? <img src={f.url} alt={f.name} className={styles.thumbImg} onError={e => { e.target.style.display = 'none' }} />
                      : <div className={styles.thumbFallback}><i className="ti ti-photo" style={{ fontSize: '28px', color: 'var(--teal)' }} /></div>
                    }
                  </div>
                  <div className={styles.thumbFooter}>
                    <div className={styles.thumbLabel}>{f.name}</div>
                    {isPending ? (
                      <div onClick={e => e.stopPropagation()}>
                        {role === 'member' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => approveFile(f)}
                              disabled={fileApproving[f.path_lower]}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setCommentModal(f); setCommentText('') }}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                        {role === 'admin' && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Videos & Reels ({videos.length})</div>
          <div className={styles.mediaGrid}>
            {videos.map(f => {
              const status = getFileDisplayStatus(f.path_lower)
              return (
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
                    {isPending ? (
                      <div onClick={e => e.stopPropagation()}>
                        {role === 'member' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => approveFile(f)}
                              disabled={fileApproving[f.path_lower]}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setCommentModal(f); setCommentText('') }}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                        {role === 'admin' && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Other Files ({others.length})</div>
          <div className={styles.mediaGrid}>
            {others.map(f => {
              const status = getFileDisplayStatus(f.path_lower)
              return (
                <div key={f.id} className={styles.thumb}>
                  <div className={styles.thumbImgWrap}>
                    <div className={styles.thumbFallback}><i className="ti ti-file" style={{ fontSize: '28px', color: 'var(--text3)' }} /></div>
                  </div>
                  <div className={styles.thumbFooter}>
                    <div className={styles.thumbLabel}>{f.name}</div>
                    {isPending ? (
                      <div>
                        {role === 'member' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => approveFile(f)}
                              disabled={fileApproving[f.path_lower]}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setCommentModal(f); setCommentText('') }}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '11px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className={styles.thumbActionBtn} onClick={() => handleDownload(f)}><i className="ti ti-download" /></button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
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

