import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
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
  if (!res.ok) throw new Error('Dropbox request failed')
  const data = await res.json()
  return data.entries || []
}

// Recursively collects every file under `path`, across all subfolders, with
// preview URLs resolved. Used only for the review experience — normal
// folder browsing stays single-level via listDropboxFolder/loadFolder above,
// so this doesn't touch performance anywhere except while reviewing.
async function listDropboxFilesRecursive(path) {
  const raw = await listDropboxFolder(path)
  const files = raw.filter(e => e['.tag'] === 'file')
  const folders = raw.filter(e => e['.tag'] === 'folder')
  const filesWithUrls = await Promise.all(files.map(async file => {
    const type = getFileType(file.name)
    let url = null
    if (type === 'photo' || type === 'video') url = await getPreviewLink(file.path_lower)
    return { ...file, type, url }
  }))
  const nested = await Promise.all(folders.map(f => listDropboxFilesRecursive(f.path_lower)))
  return [...filesWithUrls, ...nested.flat()]
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
      background: s.bg, color: s.color, fontSize: '12px',
      padding: '3px 8px', borderRadius: '20px'
    }}>
      <i className={`ti ${s.icon}`} style={{ fontSize: '12px' }} aria-hidden="true" />
      {s.label}
    </div>
  )
}

function DueDateBadge({ dueDate, status, canEdit, onEdit }) {
  if (!dueDate && !canEdit) return null
  const isOverdue = dueDate && status !== 'approved' && new Date(dueDate + 'T23:59:59') < new Date()
  const label = dueDate
    ? new Date(dueDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Set due date'
  return (
    <div
      onClick={canEdit ? (e => { e.stopPropagation(); onEdit() }) : undefined}
      title={canEdit ? 'Click to change due date' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: isOverdue ? '#2a1a1a' : dueDate ? 'rgba(136,135,128,0.14)' : 'transparent',
        color: isOverdue ? '#F0997B' : dueDate ? 'var(--text2)' : 'var(--text3)',
        fontSize: '12px', padding: '3px 8px', borderRadius: '20px',
        border: dueDate ? 'none' : '0.5px dashed var(--border)',
        cursor: canEdit ? 'pointer' : 'default'
      }}
    >
      <i className="ti ti-calendar-event" style={{ fontSize: '12px' }} aria-hidden="true" />
      {isOverdue ? `Overdue · ${label}` : label}
    </div>
  )
}

export default function Content() {
  const { client, role, loadUserContext } = useClient()
  const location = useLocation()
  const clientName = client?.name || 'Glowing Moon Media'
  const ROOT = `/Glowing Moon Portal/${clientName}/Content`

  const [stack, setStack] = useState(null)

  useEffect(() => {
    if (!client) return
    const jumpPath = location.state?.jumpToFolderPath
    if (jumpPath) {
      const jumpStack = buildStackFromPath(jumpPath)
      if (jumpStack) {
        setStack(jumpStack)
        window.history.replaceState({}, document.title)
        return
      }
    }
    // No explicit deep-link this time — try to restore whatever folder was
    // last viewed for this client, instead of always resetting to root.
    // Component state (`stack`) doesn't survive switching to another page
    // and back, since React unmounts this page entirely — sessionStorage
    // does, so that's where "last viewed" lives. Falls back to root if
    // nothing was saved, or if the saved folder no longer resolves (e.g.
    // it was deleted since).
    const savedPath = sessionStorage.getItem(`contentLibraryPath:${client.id}`)
    if (savedPath) {
      const savedStack = buildStackFromPath(savedPath)
      if (savedStack) {
        setStack(savedStack)
        return
      }
    }
    setStack([{ name: 'Content', path: `/Glowing Moon Portal/${client.name}/Content` }])
  }, [client?.name])

  // Persist the current folder every time it changes, so it's there to
  // restore next time this page mounts.
  useEffect(() => {
    if (client?.id && stack?.length) {
      sessionStorage.setItem(`contentLibraryPath:${client.id}`, stack[stack.length - 1].path)
    }
  }, [client?.id, stack])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [newFolderModal, setNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [commentModal, setCommentModal] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [threadMessages, setThreadMessages] = useState([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [cycles, setCycles] = useState([])
  const [fileStatuses, setFileStatuses] = useState({})
  const [dueDates, setDueDates] = useState({})
  const [revisionPaths, setRevisionPaths] = useState({})
  const [unresolvedNoteFolders, setUnresolvedNoteFolders] = useState(new Set())
  const [approvedAt, setApprovedAt] = useState({})
  const [bulkApproving, setBulkApproving] = useState(false)
  const [fileApproving, setFileApproving] = useState({})
  const [reopeningFile, setReopeningFile] = useState({})
  const [sendReviewModal, setSendReviewModal] = useState(false)
  const [selectedForReview, setSelectedForReview] = useState(new Set())
  const [sendReviewPlanned, setSendReviewPlanned] = useState('')
  const [sendReviewDueDate, setSendReviewDueDate] = useState('')
  const [sendingReview, setSendingReview] = useState(false)
  const [reviewFiles, setReviewFiles] = useState([])
  const [loadingReviewFiles, setLoadingReviewFiles] = useState(false)
  const [sendReviewFileCount, setSendReviewFileCount] = useState(null)
  const fileRef = useRef()
  const dueDateInputRef = useRef()

  const currentPath = stack ? stack[stack.length - 1].path : null
  const currentCycle = cycles.find(c => c.folder_path === currentPath) || null
  const cycleEffectiveStage = currentCycle ? (currentCycle.manual_override || currentCycle.stage) : null
  const isPending = !!currentCycle && cycleEffectiveStage !== 'approved'
  const approvalMonth = currentCycle?.folder_label
  const approvalDueDate = currentCycle?.due_date
  const approvalFolderPath = currentCycle?.folder_path
  const isViewingReviewFolder = !!currentCycle && currentPath === currentCycle.folder_path

  useEffect(() => {
    if (currentPath) loadFolder(currentPath)
  }, [currentPath])

  useEffect(() => {
    if (isViewingReviewFolder && currentPath) loadReviewFiles(currentPath)
    else setReviewFiles([])
  }, [isViewingReviewFolder, currentPath])

  async function loadReviewFiles(path) {
    setLoadingReviewFiles(true)
    try {
      const files = await listDropboxFilesRecursive(path)
      setReviewFiles(files)
    } catch (err) {
      console.error('loadReviewFiles error:', err)
    }
    setLoadingReviewFiles(false)
  }

  useEffect(() => {
    if (client?.id) { loadStatusData(); loadCycles() }
  }, [client?.id])

  async function loadCycles() {
    const { data } = await supabase
      .from('review_cycles')
      .select('*')
      .eq('client_id', client.id)
      .is('resolved_at', null)
      .order('sent_at', { ascending: false })
    setCycles(data || [])
  }

  // Recomputes and persists a cycle's derived stage from its file_status /
  // file_comments rows. This is the one place the automated formula lives —
  // any revision note on the cycle wins, otherwise all-approved wins,
  // otherwise it's still in_review. manual_override (if set) takes visual
  // precedence over this everywhere it's read, but the stored `stage` column
  // always reflects what the files actually say.
  async function recomputeCycleStage(cycleId) {
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('status').eq('cycle_id', cycleId),
      supabase.from('file_comments').select('id').eq('cycle_id', cycleId).eq('resolved', false).limit(1)
    ])
    let stage = 'in_review'
    if ((commentRows || []).length > 0) stage = 'revisions'
    else if ((statusRows || []).length > 0 && statusRows.every(r => r.status === 'approved')) stage = 'approved'
    await supabase.from('review_cycles').update({ stage }).eq('id', cycleId)
    await loadCycles()
    return stage
  }

  async function loadStatusData() {
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('file_path, status, due_date, cycle_id, updated_at').eq('client_id', client.id),
      supabase.from('file_comments').select('file_path, folder_path').eq('client_id', client.id).eq('resolved', false)
    ])
    const statusMap = {}
    const dueMap = {}
    const approvedAtMap = {}
    ;(statusRows || []).forEach(r => {
      statusMap[r.file_path] = r.status
      if (r.due_date) dueMap[r.file_path] = r.due_date
      if (r.status === 'approved' && r.updated_at) approvedAtMap[r.file_path] = r.updated_at
    })
    setFileStatuses(statusMap)
    setDueDates(dueMap)
    setApprovedAt(approvedAtMap)
    const revMap = {}
    const foldersWithNotes = new Set()
    ;(commentRows || []).forEach(r => {
      if (r.folder_path) foldersWithNotes.add(r.folder_path.toLowerCase())
    })
    setUnresolvedNoteFolders(foldersWithNotes)
    ;(commentRows || []).forEach(r => { revMap[r.file_path] = true })
    setRevisionPaths(revMap)
  }

  async function setDueDate(file) {
    const current = dueDates[file.path_lower] || ''
    const input = window.prompt('Set due date (YYYY-MM-DD), or clear the field to remove it:', current)
    if (input === null) return
    const trimmed = input.trim()
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return window.alert('Please use the format YYYY-MM-DD, e.g. 2026-08-15')
    }
    const value = trimmed || null
    const { error } = await supabase
      .from('file_status')
      .upsert({
        client_id: client.id,
        file_path: file.path_lower,
        status: fileStatuses[file.path_lower] || 'in_review',
        due_date: value
      }, { onConflict: 'client_id,file_path' })
    if (error) return window.alert('Could not save due date.')
    setDueDates(prev => {
      const next = { ...prev }
      if (value) next[file.path_lower] = value
      else delete next[file.path_lower]
      return next
    })
  }

  function isNew(file) {
    if (!file?.client_modified) return false
    if (getFileDisplayStatus(file.path_lower) === 'approved') return false
    const modified = new Date(file.client_modified).getTime()
    return Date.now() - modified < 7 * 24 * 60 * 60 * 1000
  }

  function wasModifiedSinceApproval(file) {
    // Resend for Review should only ever show when the underlying file
    // actually changed after approval (a same-filename reupload leaving a
    // stale 'approved' status behind) — not on every approved file
    // unconditionally, which just invites confusion or accidental clicks
    // on files nobody touched.
    const approvedTimestamp = approvedAt[file.path_lower]
    if (!approvedTimestamp || !file?.client_modified) return false
    return new Date(file.client_modified).getTime() > new Date(approvedTimestamp).getTime()
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
    setLoadError(false)
    try {
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
    } catch (err) {
      console.error('loadFolder error:', err)
      setLoadError(true)
    }
    setLoading(false)
  }

  function openFolder(folder) {
    setStack(prev => [...prev, { name: folder.name, path: folder.path_lower }])
  }

  function goBack(index) {
    setStack(prev => prev.slice(0, index + 1))
  }

  function buildStackFromPath(fullPath) {
    if (!fullPath || !client) return null
    const parts = fullPath.split('/').filter(Boolean)
    const contentIdx = parts.findIndex(p => p.toLowerCase() === 'content')
    if (contentIdx === -1) return null
    let cumulative = ''
    parts.slice(0, contentIdx + 1).forEach(p => { cumulative += '/' + p })
    const result = [{ name: 'Content', path: cumulative }]
    for (let i = contentIdx + 1; i < parts.length; i++) {
      cumulative += '/' + parts[i]
      result.push({ name: parts[i], path: cumulative })
    }
    return result
  }

  function jumpToReviewFolder() {
    const newStack = buildStackFromPath(approvalFolderPath)
    if (newStack) setStack(newStack)
  }

  async function cancelReview() {
    if (!currentCycle) return
    const confirmed = window.confirm(`Cancel this review cycle for "${currentCycle.folder_label || currentCycle.folder_path}"? This removes it entirely — any approvals or revision notes on it go with it. This can't be undone.`)
    if (!confirmed) return
    await supabase.from('review_cycles').delete().eq('id', currentCycle.id)
    await loadCycles()
  }

  function toggleFileForReview(pathLower) {
    setSelectedForReview(prev => {
      const next = new Set(prev)
      if (next.has(pathLower)) next.delete(pathLower)
      else next.add(pathLower)
      return next
    })
  }

  async function openSendReviewModal() {
    setSendReviewModal(true)
    if (selectedForReview.size > 0) {
      setSendReviewFileCount(selectedForReview.size)
      return
    }
    setSendReviewFileCount(null)
    try {
      const files = await listDropboxFilesRecursive(currentPath)
      setSendReviewFileCount(files.length)
    } catch (err) {
      console.error('Count fetch error:', err)
      setSendReviewFileCount(0)
    }
  }

  async function sendForReview() {
    if (!client?.id || !currentPath || !stack) return
    if (cycles.some(c => c.folder_path === currentPath)) {
      window.alert('This folder already has an active review cycle. Use Clear Stage or Clear Cycle in Admin if you need to reset it — no need to resend.')
      return
    }
    setSendingReview(true)
    const folderLabel = stack[stack.length - 1].name
    const isSelective = selectedForReview.size > 0

    // Captured BEFORE any clearing happens — this is the only source of
    // truth for "which files were already approved," since a file with no
    // status row at all defaults to in_review. Without carrying this
    // forward, a selective send targeting one file would incorrectly make
    // every other file in the folder look unreviewed again too.
    const previouslyApprovedPaths = isSelective
      ? Object.entries(fileStatuses).filter(([path, status]) => status === 'approved' && !selectedForReview.has(path)).map(([path]) => path)
      : []

    try {
      // Clear any existing file_status rows for files in this folder so a
      // re-sent review starts fresh (prevents instant auto-approval).
      // Note: this only clears rows left behind from a resolved cycle on the
      // same path — an active cycle on this exact folder shouldn't exist,
      // since Admin only shows Send for Review where one isn't already open.
      const folderPrefix = currentPath.toLowerCase()
      const { data: existingRows } = await supabase
        .from('file_status')
        .select('id, file_path')
        .eq('client_id', client.id)
      const rowsToDelete = (existingRows || []).filter(r => r.file_path.startsWith(folderPrefix))
      if (rowsToDelete.length > 0) {
        await supabase.from('file_status').delete().in('id', rowsToDelete.map(r => r.id))
      }

      const { data: newCycle, error: cycleError } = await supabase
        .from('review_cycles')
        .insert({
          client_id: client.id,
          folder_path: currentPath,
          folder_label: folderLabel,
          stage: 'in_review',
          planned_count: parseInt(sendReviewPlanned) || null,
          due_date: sendReviewDueDate || null,
          sent_at: new Date().toISOString()
        })
        .select()
        .single()

      if (cycleError) {
        window.alert('Could not start a new review cycle — check the 5-active-cycle limit.')
        setSendingReview(false)
        return
      }

      // Re-affirm every previously-approved file under the new cycle, so a
      // selective send on one file doesn't reopen everything else.
      if (previouslyApprovedPaths.length > 0) {
        await supabase.from('file_status').insert(
          previouslyApprovedPaths.map(path => ({
            client_id: client.id,
            cycle_id: newCycle.id,
            file_path: path,
            status: 'approved',
            updated_at: new Date().toISOString()
          }))
        )
      }

      const yearMatch = folderLabel.match(/\d{4}/)
      if (yearMatch) {
        const year = parseInt(yearMatch[0])
        const monthName = folderLabel.replace(yearMatch[0], '').trim() || folderLabel
        try {
          await supabase.from('content_months').upsert({
            client_id: client.id,
            month: monthName,
            year,
            planned: parseInt(sendReviewPlanned) || 0
          }, { onConflict: 'client_id,month,year' })
        } catch (err) {
          console.error('content_months upsert skipped:', err)
        }
      }

      if (client.notification_email) {
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({
            type: isSelective ? 'file_revised' : 'review',
            clientName: client.name,
            month: folderLabel,
            fileName: isSelective ? [...selectedForReview].map(p => p.split('/').pop()).join(', ') : undefined,
            notificationEmail: client.notification_email
          })
        })
      }

      setSelectedForReview(new Set())
      await loadCycles()
      await loadStatusData()
      setSendReviewModal(false)
      setSendReviewPlanned('')
      setSendReviewDueDate('')
    } catch (err) {
      console.error('Send for review error:', err)
    }
    setSendingReview(false)
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
    await logAction('upload', 'content', { count: selected.length, folder: stack?.[stack.length - 1]?.name }, client?.id)
    // A new file lands with no file_status row, which defaults to
    // "in review" — but a folder's cached cycle stage doesn't know that on
    // its own. Without this, a folder that was fully approved would keep
    // showing "Approved" in Admin's tracker even after a fresh, unreviewed
    // file gets added to it.
    if (currentCycle) {
      await recomputeCycleStage(currentCycle.id)
      await loadStatusData()
    }
  }

  async function handleDeleteFile(file) {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    await deleteFile(file.path_lower)
    await logAction('delete', 'content', { fileName: file.name, path: file.path_lower }, client?.id)
    setEntries(prev => prev.filter(e => e.id !== file.id))
    if (client?.id) incrementFileCount(client.id, 'content', -1)
  }

  async function handleDeleteFolder(folder) {
    if (!window.confirm(`Delete the folder "${folder.name}" and everything inside it? This cannot be undone.`)) return
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
      await logAction('download', 'content', { fileName: file.name, path: file.path_lower }, client?.id)
    }
  }

  async function openThread(file) {
    setCommentModal(file)
    setCommentText('')
    setLoadingThread(true)
    // Loads the FOLDER's full conversation, not just this one file's
    // messages — a note stays visible here even after the file it was
    // originally about gets replaced with a new upload. `file_path` on each
    // message is still shown as a label (which file it was about), it's
    // just no longer the lookup key.
    const { data } = await supabase
      .from('file_comments')
      .select('*')
      .eq('client_id', client.id)
      .eq('folder_path', currentPath)
      .order('created_at', { ascending: true })
    setThreadMessages(data || [])
    setLoadingThread(false)
  }

  async function submitComment() {
    if (!commentText.trim() || !commentModal || !currentCycle) return
    setSubmittingComment(true)
    await supabase.from('file_comments').insert({
      client_id: client.id,
      cycle_id: currentCycle.id,
      folder_path: currentPath,
      file_path: commentModal.path_lower,
      comment: commentText.trim(),
      sender_role: role === 'admin' || role === 'editor' ? 'admin' : 'member',
      read: false
    })
    if (role === 'member' || role === 'viewer') {
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
      await recomputeCycleStage(currentCycle.id)
      setCommentText('')
      setSubmittingComment(false)
      setCommentModal(null)
      return
    }
    const { data } = await supabase
      .from('file_comments')
      .select('*')
      .eq('client_id', client.id)
      .eq('folder_path', currentPath)
      .order('created_at', { ascending: true })
    setThreadMessages(data || [])
    if (client.notification_email) {
      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'comment_reply',
          notificationEmail: client.notification_email,
          fileName: commentModal.name,
          comment: commentText.trim()
        })
      })
    }
    setCommentText('')
    setSubmittingComment(false)
  }

  async function resolveRevision(file) {
    if (!currentCycle) return
    // Marks resolved instead of deleting — the note stays in the folder's
    // permanent history, it just stops blocking this cycle's approval.
    // Scoped to the CURRENT cycle only, so resolving today's note never
    // touches an older, already-historical one from a previous cycle.
    await supabase.from('file_comments').update({ resolved: true })
      .eq('cycle_id', currentCycle.id).eq('file_path', file.path_lower).eq('resolved', false)
    setRevisionPaths(prev => {
      const next = { ...prev }
      delete next[file.path_lower]
      return next
    })
    await recomputeCycleStage(currentCycle.id)
  }

  async function fireApprovalSideEffects() {
    try {
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
    } catch (err) {
      console.error('Approval side-effects error:', err)
    }
  }

  async function upsertApproved(files) {
    if (!client?.id || !files.length || !currentCycle) return
    const isBulk = files.length > 1
    if (isBulk) setBulkApproving(true)
    else setFileApproving(p => ({ ...p, [files[0].path_lower]: true }))

    const rows = files.map(f => ({
      client_id: client.id,
      cycle_id: currentCycle.id,
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

    const stage = await recomputeCycleStage(currentCycle.id)
    if (stage === 'approved') await fireApprovalSideEffects()
  }

  async function approveFile(file) {
    await upsertApproved([file])
  }

  async function reopenFileForReview(file) {
    // Flips one file back to in_review within the SAME already-open cycle
    // — no new review cycle needed, since a cycle stays active until every
    // file in it is approved anyway. This also fixes a real data-integrity
    // gap: if a revised file gets uploaded under the same filename
    // (overwriting in place), its old 'approved' status would otherwise
    // sit there stale forever, never prompting the client to look again.
    if (!client?.id || !currentCycle) return
    setReopeningFile(p => ({ ...p, [file.path_lower]: true }))

    const { error } = await supabase.from('file_status').upsert({
      client_id: client.id,
      cycle_id: currentCycle.id,
      file_path: file.path_lower,
      status: 'in_review',
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id,file_path' })

    if (error) {
      console.error('Reopen file error:', error)
      setReopeningFile(p => ({ ...p, [file.path_lower]: false }))
      return
    }

    setFileStatuses(prev => ({ ...prev, [file.path_lower]: 'in_review' }))
    setReopeningFile(p => ({ ...p, [file.path_lower]: false }))
    await recomputeCycleStage(currentCycle.id)

    if (client.notification_email) {
      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'file_revised',
          clientName: client.name,
          fileName: file.name,
          notificationEmail: client.notification_email
        })
      })
    }
  }

  async function approveAllRemaining() {
    const targets = entries
      .filter(e => e.type !== 'folder')
      .filter(f => getFileDisplayStatus(f.path_lower) === 'in_review')
    if (targets.length) await upsertApproved(targets)
  }

  const folders = entries.filter(e => e.type === 'folder')
  const fileSource = isViewingReviewFolder ? reviewFiles : entries
  const photos = fileSource.filter(e => e.type === 'photo')
  const videos = fileSource.filter(e => e.type === 'video')
  const others = fileSource.filter(e => e.type !== 'folder' && e.type !== 'photo' && e.type !== 'video')
  const allFiles = [...photos, ...videos, ...others]

  // Direct check against folder_path — the authoritative field, set once
  // when a comment is made and never touched again, exactly so it stays
  // reliable even if files inside that folder get renamed or replaced
  // later. No need to derive or guess this from file_path at all.
  const currentPathPrefix = (currentPath || '').toLowerCase()
  const folderHasUnresolvedNote = unresolvedNoteFolders.has(currentPathPrefix)

  const statusCounts = allFiles.reduce((acc, f) => {
    const s = getFileDisplayStatus(f.path_lower)
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})
  const totalFiles = allFiles.length
  const remainingCount = statusCounts.in_review || 0
  const showHeroReview = role === 'member' && isPending && isViewingReviewFolder
  const allApproved = totalFiles > 0 && statusCounts.approved === totalFiles
  const approvedFraction = totalFiles > 0 ? statusCounts.approved / totalFiles : 0
  const ringCircumference = 264
  const ringOffset = Math.round(ringCircumference - ringCircumference * approvedFraction)

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
        {(role === 'admin' || role === 'editor') && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {folderHasUnresolvedNote && (
              <button
                className="btn"
                style={{ color: '#F0997B', border: '0.5px solid #F0997B' }}
                onClick={() => openThread(allFiles[0] || { name: stack?.[stack.length - 1]?.name, path_lower: currentPath })}
              >
                <i className="ti ti-message" /> Revision Notes
              </button>
            )}
            {stack?.length > 1 && !(isPending && isViewingReviewFolder) && (
              <button className="btn btn-gold" onClick={openSendReviewModal}>
                <i className="ti ti-send" /> {selectedForReview.size > 0 ? `Send ${selectedForReview.size} Selected` : 'Send for Review'}
              </button>
            )}
            {selectedForReview.size > 0 && (
              <button className="btn" style={{ fontSize: '12px', color: 'var(--text3)' }} onClick={() => setSelectedForReview(new Set())}>
                Clear selection
              </button>
            )}
            {isPending && isViewingReviewFolder && currentCycle && (
              <button className="btn" style={{ color: '#F0997B' }} onClick={cancelReview}>
                <i className="ti ti-x" /> Cancel Review
              </button>
            )}
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

      {showHeroReview && (
        <div style={{ background: '#0E0E0F', borderRadius: '14px', overflow: 'hidden', marginBottom: '24px' }}>
          <div style={{ padding: '34px 34px 30px', borderBottom: '0.5px solid #2B2B2E' }}>
            <div style={{ fontSize: '12px', letterSpacing: '2.5px', color: '#D3C9A7', marginBottom: '14px' }}>
              {allApproved ? "THAT'S A WRAP" : 'READY FOR REVIEW'}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '30px', lineHeight: '1.15', color: '#F4EEE2', marginBottom: '12px' }}>
                  {allApproved
                    ? <>That's a wrap on<br />{approvalMonth}</>
                    : <>Your {approvalMonth}<br />content has arrived</>
                  }
                </div>
                <div style={{ fontSize: '13px', color: '#8a8880', lineHeight: '1.6', maxWidth: '360px' }}>
                  {allApproved
                    ? 'Everything here has been approved. Thanks for the quick turnaround.'
                    : `${totalFiles} new piece${totalFiles !== 1 ? 's' : ''}, crafted for ${client?.name}. Take your time, flag anything that needs a tweak, and approve when it feels right.`
                  }
                </div>
                {!allApproved && approvalDueDate && (() => {
                  const overdue = new Date(approvalDueDate + 'T23:59:59') < new Date()
                  const dateLabel = new Date(approvalDueDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
                  return (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '12px',
                      fontSize: '12px', color: overdue ? '#F0997B' : '#D3C9A7',
                      background: overdue ? '#2a1a1a' : 'rgba(211,201,167,0.1)',
                      padding: '5px 11px', borderRadius: '20px'
                    }}>
                      <i className="ti ti-calendar-event" style={{ fontSize: '13px' }} aria-hidden="true" />
                      {overdue ? `Review was due ${dateLabel}` : `Please review by ${dateLabel}`}
                    </div>
                  )
                })()}
              </div>

              {!allApproved && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                  <div style={{ position: 'relative', width: '96px', height: '96px' }}>
                    <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="48" cy="48" r="42" fill="none" stroke="#2B2B2E" strokeWidth="7" />
                      <circle
                        cx="48" cy="48" r="42" fill="none" stroke="#D3C9A7" strokeWidth="7"
                        strokeLinecap="round" strokeDasharray={ringCircumference}
                        strokeDashoffset={ringOffset}
                        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                      />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ fontSize: '22px', color: '#F4EEE2', fontWeight: '500', lineHeight: '1' }}>
                        {statusCounts.approved || 0}<span style={{ fontSize: '13px', color: '#8a8880' }}>/{totalFiles}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8a8880', marginTop: '2px' }}>approved</div>
                    </div>
                  </div>
                  {remainingCount > 0 && (
                    <button
                      onClick={approveAllRemaining}
                      disabled={bulkApproving}
                      style={{ background: '#D3C9A7', color: '#0E0E0F', border: 'none', borderRadius: '7px', padding: '9px 18px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {bulkApproving ? 'Approving...' : 'Approve all remaining'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: '26px 34px 34px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: '16px' }}>
              {allFiles.map(f => {
                const status = getFileDisplayStatus(f.path_lower)
                const borderColor = status === 'approved' ? 'rgba(29,158,117,0.4)' : status === 'revision' ? 'rgba(216,90,48,0.45)' : '#2B2B2E'
                return (
                  <div key={f.id} style={{ background: '#151517', border: `0.5px solid ${borderColor}`, borderRadius: '12px', overflow: 'hidden' }}>
                    <div onClick={() => setLightbox(f)} style={{ height: '130px', background: '#1e1e22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a3a3e', position: 'relative', cursor: 'pointer' }}>
                      {f.type === 'photo' && f.url && <img src={f.url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />}
                      {f.type === 'video' && f.url && <video src={f.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} preload="metadata" muted />}
                      {!f.url && <i className={`ti ${f.type === 'video' ? 'ti-video' : 'ti-photo'}`} style={{ fontSize: '30px' }} aria-hidden="true" />}
                      {f.type === 'video' && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'rgba(14,14,15,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <i className="ti ti-player-play" style={{ fontSize: '16px', color: '#F4EEE2' }} />
                          </div>
                        </div>
                      )}
                      {isNew(f) && (
                        <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'var(--gold-light)', color: '#0E0E0F', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '20px' }}>
                          NEW
                        </div>
                      )}
                      {status === 'approved' && (
                        <div style={{ position: 'absolute', top: '10px', right: '10px', width: '24px', height: '24px', borderRadius: '50%', background: '#1D9E75', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="ti ti-check" style={{ fontSize: '14px', color: '#0E0E0F' }} />
                        </div>
                      )}
                      {status === 'revision' && (
                        <div style={{ position: 'absolute', top: '10px', right: '10px', width: '24px', height: '24px', borderRadius: '50%', background: '#D85A30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="ti ti-message" style={{ fontSize: '13px', color: '#0E0E0F' }} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '13px 14px' }}>
                      <div style={{ fontSize: '12px', color: '#F4EEE2', marginBottom: status === 'in_review' ? '10px' : '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                      {status === 'in_review' && (
                        <div style={{ display: 'flex', gap: '7px' }}>
                          <button
                            onClick={() => approveFile(f)}
                            disabled={fileApproving[f.path_lower]}
                            style={{ flex: 1, background: '#1D9E75', border: 'none', color: '#0E0E0F', borderRadius: '6px', padding: '7px 0', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => openThread(f)}
                            style={{ flex: 1, background: 'transparent', border: '0.5px solid #3a3a3e', color: '#b4b2a9', borderRadius: '6px', padding: '7px 0', fontSize: '12px', cursor: 'pointer' }}
                          >
                            Revise
                          </button>
                        </div>
                      )}
                      {status === 'approved' && <div style={{ fontSize: '12px', color: '#5DCAA5' }}>Approved</div>}
                      {status === 'revision' && (
                        <div onClick={() => openThread(f)} style={{ fontSize: '12px', color: '#F0997B', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                          Revision sent — view thread
                        </div>
                      )}
                      {status === 'in_production' && <div style={{ fontSize: '12px', color: '#8a8880' }}>In production</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!showHeroReview && (<>
      {isPending && !isViewingReviewFolder && (
        <div style={{
          background: '#0E0E0F',
          border: `1px solid ${client?.primary_color || 'var(--gold-light)'}66`,
          borderRadius: '12px',
          padding: '26px 28px',
          marginBottom: '24px',
          boxShadow: `0 0 24px 0 ${client?.primary_color || '#D3C9A7'}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '20px', flexWrap: 'wrap'
        }}>
          <div>
            <div style={{ fontSize: '12px', letterSpacing: '2px', color: 'var(--gold-light)', marginBottom: '8px' }}>
              READY FOR REVIEW
            </div>
            <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '22px', color: '#F4EEE2', marginBottom: '6px' }}>
              {approvalMonth ? `Your ${approvalMonth} content is ready` : 'Content is ready for review'}
            </div>
            <div style={{ fontSize: '13px', color: '#8a8880' }}>
              Take a look, leave any notes, and approve when it feels right.
            </div>
          </div>
          {approvalFolderPath && (
            <button
              onClick={jumpToReviewFolder}
              style={{
                background: 'var(--gold-light)', color: '#0E0E0F', border: 'none',
                borderRadius: '8px', padding: '12px 22px', fontSize: '14px', fontWeight: '600',
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
              }}
            >
              Review Now <i className="ti ti-arrow-right" style={{ marginLeft: '4px' }} />
            </button>
          )}
        </div>
      )}

      {isPending && isViewingReviewFolder && (
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

      {!loading && loadError && (
        <div className={styles.emptyState}>
          <i className="ti ti-plug-connected-x" style={{ fontSize: '36px', color: 'var(--coral, #D85A30)', marginBottom: '12px' }} />
          <div style={{ fontSize: '14px', color: 'var(--text1)', marginBottom: '4px' }}>We're having trouble connecting to your files</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)' }}>This isn't an empty folder — try refreshing, or check back shortly.</div>
        </div>
      )}

      {!loading && !loadError && entries.length === 0 && (
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
                {(role === 'admin' || role === 'editor') && (
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
                  <div className={styles.thumbImgWrap} style={{ position: 'relative' }}>
                    {isNew(f) && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 1, background: 'var(--gold-light)', color: '#0E0E0F', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '20px' }}>
                        NEW
                      </div>
                    )}
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
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : role === 'viewer' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <StatusBadge status={status} />
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Comment
                            </button>
                          </div>
                        ) : (
                          <>
                            <StatusBadge status={status} />
                            <span style={{ marginLeft: '6px' }}>
                              <DueDateBadge
                                dueDate={dueDates[f.path_lower]}
                                status={status}
                                canEdit={role === 'admin' || role === 'editor'}
                                onEdit={() => setDueDate(f)}
                              />
                            </span>
                            {(role === 'admin' || role === 'editor' || role === 'viewer') && status === 'revision' && (
                              <button
                                onClick={() => openThread(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                View
                              </button>
                            )}
                            {role === 'admin' && status === 'revision' && (
                              <button
                                onClick={() => resolveRevision(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                Mark Resolved
                              </button>
                            )}
                            {(role === 'admin' || role === 'editor') && status === 'approved' && wasModifiedSinceApproval(f) && (
                              <button
                                onClick={() => reopenFileForReview(f)}
                                disabled={reopeningFile[f.path_lower]}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--gold-light)', color: 'var(--gold-light)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                {reopeningFile[f.path_lower] ? 'Sending...' : 'Resend for Review'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {(role === 'admin' || role === 'editor') && !cycles.some(c => c.folder_path === currentPath) && (
                          <input
                            type="checkbox"
                            checked={selectedForReview.has(f.path_lower)}
                            onChange={e => { e.stopPropagation(); toggleFileForReview(f.path_lower) }}
                            onClick={e => e.stopPropagation()}
                            title="Select for review"
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                        <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                        {(role === 'admin' || role === 'editor') && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
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
                  <div className={styles.thumbImgWrap} style={{ position: 'relative' }}>
                    {isNew(f) && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 1, background: 'var(--gold-light)', color: '#0E0E0F', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '20px' }}>
                        NEW
                      </div>
                    )}
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
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : role === 'viewer' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <StatusBadge status={status} />
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Comment
                            </button>
                          </div>
                        ) : (
                          <>
                            <StatusBadge status={status} />
                            <span style={{ marginLeft: '6px' }}>
                              <DueDateBadge
                                dueDate={dueDates[f.path_lower]}
                                status={status}
                                canEdit={role === 'admin' || role === 'editor'}
                                onEdit={() => setDueDate(f)}
                              />
                            </span>
                            {(role === 'admin' || role === 'editor' || role === 'viewer') && status === 'revision' && (
                              <button
                                onClick={() => openThread(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                View
                              </button>
                            )}
                            {role === 'admin' && status === 'revision' && (
                              <button
                                onClick={() => resolveRevision(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                Mark Resolved
                              </button>
                            )}
                            {(role === 'admin' || role === 'editor') && status === 'approved' && wasModifiedSinceApproval(f) && (
                              <button
                                onClick={() => reopenFileForReview(f)}
                                disabled={reopeningFile[f.path_lower]}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--gold-light)', color: 'var(--gold-light)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                {reopeningFile[f.path_lower] ? 'Sending...' : 'Resend for Review'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {(role === 'admin' || role === 'editor') && !cycles.some(c => c.folder_path === currentPath) && (
                          <input
                            type="checkbox"
                            checked={selectedForReview.has(f.path_lower)}
                            onChange={e => { e.stopPropagation(); toggleFileForReview(f.path_lower) }}
                            onClick={e => e.stopPropagation()}
                            title="Select for review"
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                        <button className={styles.thumbActionBtn} onClick={e => { e.stopPropagation(); handleDownload(f) }}><i className="ti ti-download" /></button>
                        {(role === 'admin' || role === 'editor') && <button className={styles.thumbDeleteBtn} onClick={e => { e.stopPropagation(); handleDeleteFile(f) }}><i className="ti ti-trash" /></button>}
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
                  <div className={styles.thumbImgWrap} style={{ position: 'relative' }}>
                    {isNew(f) && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 1, background: 'var(--gold-light)', color: '#0E0E0F', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '20px' }}>
                        NEW
                      </div>
                    )}
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
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Revise
                            </button>
                          </div>
                        ) : role === 'viewer' && status === 'in_review' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <StatusBadge status={status} />
                            <button
                              onClick={() => openThread(f)}
                              style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Comment
                            </button>
                          </div>
                        ) : (
                          <>
                            <StatusBadge status={status} />
                            <span style={{ marginLeft: '6px' }}>
                              <DueDateBadge
                                dueDate={dueDates[f.path_lower]}
                                status={status}
                                canEdit={role === 'admin' || role === 'editor'}
                                onEdit={() => setDueDate(f)}
                              />
                            </span>
                            {(role === 'admin' || role === 'editor' || role === 'viewer') && status === 'revision' && (
                              <button
                                onClick={() => openThread(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                View
                              </button>
                            )}
                            {role === 'admin' && status === 'revision' && (
                              <button
                                onClick={() => resolveRevision(f)}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--teal)', color: 'var(--teal)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                Mark Resolved
                              </button>
                            )}
                            {(role === 'admin' || role === 'editor') && status === 'approved' && wasModifiedSinceApproval(f) && (
                              <button
                                onClick={() => reopenFileForReview(f)}
                                disabled={reopeningFile[f.path_lower]}
                                style={{ marginLeft: '6px', background: 'transparent', border: '0.5px solid var(--gold-light)', color: 'var(--gold-light)', borderRadius: '5px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                {reopeningFile[f.path_lower] ? 'Sending...' : 'Resend for Review'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {(role === 'admin' || role === 'editor') && !cycles.some(c => c.folder_path === currentPath) && (
                          <input
                            type="checkbox"
                            checked={selectedForReview.has(f.path_lower)}
                            onChange={e => { e.stopPropagation(); toggleFileForReview(f.path_lower) }}
                            onClick={e => e.stopPropagation()}
                            title="Select for review"
                            style={{ cursor: 'pointer' }}
                          />
                        )}
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
      </>)}

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

      {sendReviewModal && (
        <div className={styles.overlay} onClick={() => setSendReviewModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Send for Review</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '16px' }}>
              {selectedForReview.size > 0 ? (
                <>
                  Sending <strong style={{ color: 'var(--text1)' }}>{selectedForReview.size} selected file{selectedForReview.size !== 1 ? 's' : ''}</strong> in <strong style={{ color: 'var(--text1)' }}>{stack?.[stack.length - 1]?.name}</strong> to {client?.name} for review.
                  <div style={{ color: 'var(--teal)', marginTop: '6px' }}>
                    Everything else already approved in this folder stays approved — only the selected file{selectedForReview.size !== 1 ? 's' : ''} will show as needing another look.
                  </div>
                </>
              ) : (
                <>
                  Sending <strong style={{ color: 'var(--text1)' }}>{stack?.[stack.length - 1]?.name}</strong> (
                  {sendReviewFileCount === null
                    ? 'counting files…'
                    : `${sendReviewFileCount} file${sendReviewFileCount !== 1 ? 's' : ''}`}
                  ) to {client?.name} for review.
                </>
              )}
              {sendReviewFileCount === 0 && selectedForReview.size === 0 && (
                <div style={{ color: '#F0997B', marginTop: '6px' }}>
                  This folder and its subfolders don't have any files yet — nothing to send.
                </div>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Planned Deliverables (optional)</label>
              <input
                type="number"
                className={styles.input}
                value={sendReviewPlanned}
                onChange={e => setSendReviewPlanned(e.target.value)}
                placeholder="e.g. 10"
                min="0"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Review Due Date (optional)</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  ref={dueDateInputRef}
                  type="date"
                  className={styles.input}
                  value={sendReviewDueDate}
                  onChange={e => setSendReviewDueDate(e.target.value)}
                  style={{ colorScheme: 'dark' }}
                />
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => {
                    if (dueDateInputRef.current?.showPicker) dueDateInputRef.current.showPicker()
                    else dueDateInputRef.current?.focus()
                  }}
                  title="Open calendar"
                  style={{ flexShrink: 0 }}
                >
                  <i className="ti ti-calendar-event" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setSendReviewModal(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={sendForReview} disabled={sendingReview || sendReviewFileCount === null || sendReviewFileCount === 0}>
                {sendingReview ? 'Sending...' : 'Send for Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {commentModal && (
        <div className={styles.overlay} onClick={() => setCommentModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className={styles.modalTitle}>Revision Notes</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '16px' }}>
              Full history for this folder &middot; commenting on <strong>{commentModal.name}</strong>
            </div>

            <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loadingThread && <div style={{ fontSize: '12px', color: 'var(--text3)' }}>Loading...</div>}
              {!loadingThread && threadMessages.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text3)' }}>No notes yet — say what needs to change below.</div>
              )}
              {threadMessages.map(m => {
                const isMine = (role === 'admin' || role === 'editor') ? m.sender_role === 'admin' : m.sender_role !== 'admin'
                const fileLabel = m.file_path ? m.file_path.split('/').pop() : null
                return (
                  <div key={m.id} style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                    {fileLabel && (
                      <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '3px', textAlign: isMine ? 'right' : 'left' }}>
                        re: {fileLabel}{m.resolved && <span style={{ color: 'var(--teal)', marginLeft: '6px' }}><i className="ti ti-check" aria-hidden="true" /> resolved</span>}
                      </div>
                    )}
                    <div style={{
                      background: isMine ? 'var(--gold-bg)' : 'var(--surface2)',
                      color: isMine ? 'var(--gold-light)' : 'var(--text1)',
                      opacity: m.resolved ? 0.65 : 1,
                      borderRadius: '10px', padding: '8px 12px', fontSize: '13px', lineHeight: '1.5'
                    }}>
                      {m.comment}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '3px', textAlign: isMine ? 'right' : 'left' }}>
                      {m.sender_role === 'admin' ? 'Glowing Moon Media' : (client?.name || 'Client')} · {new Date(m.created_at).toLocaleDateString()}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Leave a comment</label>
              <textarea
                className={styles.input}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Type a message..."
                rows={3}
                style={{ resize: 'vertical' }}
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn" onClick={() => setCommentModal(null)}>Close</button>
              <button className="btn btn-gold" onClick={submitComment} disabled={submittingComment || !commentText.trim()}>
                {submittingComment ? 'Sending...' : 'Send'}
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
