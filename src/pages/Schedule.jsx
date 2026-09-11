import { useState, useEffect } from 'react'
import { useClient } from '../lib/ClientContext'
import { apiFetch } from '../lib/apiFetch'
import { getDownloadLink, getFileType, formatBytes } from '../lib/dropbox'
import styles from './Admin.module.css'

// Admin-only by design — gated at the route level in Portal.jsx via
// AdminRoute, the same guard already used for /admin. This page is
// intentionally its own tab rather than a section inside Admin.jsx: batch
// scheduling has enough surface area (a content bank, per-row captions,
// platform selection, per-client tracked links) that folding it into the
// Admin page would clutter a page that already covers clients, team,
// revisions, reports, and links.
//
// Editor access is a likely next step once this is tested, per the original
// ask — when that happens, swap the AdminRoute wrapper in Portal.jsx for
// something closer to MetricsRoute (role-list based) rather than the
// admin-only check, and this page's own logic shouldn't need to change.

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

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return { icon: 'ti-photo', bg: 'var(--teal-bg)', color: 'var(--teal)' }
  if (['mp4', 'mov', 'avi'].includes(ext)) return { icon: 'ti-video', bg: 'var(--gold-bg)', color: 'var(--gold-light)' }
  return { icon: 'ti-file', bg: 'rgba(255,255,255,0.05)', color: 'var(--text2)' }
}

function buildStackFromPath(root, path) {
  // Turns a saved/jump path back into a breadcrumb stack, rooted at
  // Content. Mirrors Content.jsx's version of this so restored folders
  // behave identically to a normal click-through.
  if (!path || !path.toLowerCase().startsWith(root.toLowerCase())) return null
  const rootLower = root.toLowerCase()
  const rest = path.slice(root.length).replace(/^\/+/, '')
  const parts = rest ? rest.split('/') : []
  const stack = [{ name: 'Content', path: root }]
  let acc = root
  for (const part of parts) {
    acc = `${acc}/${part}`
    stack.push({ name: part, path: acc })
  }
  return stack
}

export default function Schedule() {
  const { client, allClients } = useClient()
  const [selectedClientId, setSelectedClientId] = useState(client?.id || null)

  const selectedClient = allClients.find(c => c.id === selectedClientId)
  const clientName = selectedClient?.name

  const [stack, setStack] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const [bankFolder, setBankFolder] = useState(null) // the folder chosen as "this quarter's bank"

  useEffect(() => {
    if (!selectedClientId && allClients.length > 0) {
      setSelectedClientId(allClients[0].id)
    }
  }, [allClients])

  // Restore the last-viewed folder (and bank selection) for this client
  // instead of always resetting to Content root. This page can remount —
  // e.g. switching browser tabs away and back — and without this, that
  // silently drops you back at the top of the folder tree every time.
  // Same pattern Content.jsx already uses, same reason.
  useEffect(() => {
    if (!clientName || !selectedClientId) return
    const root = `/Glowing Moon Portal/${clientName}/Content`

    const savedPath = sessionStorage.getItem(`schedulePath:${selectedClientId}`)
    const restoredStack = savedPath ? buildStackFromPath(root, savedPath) : null
    setStack(restoredStack || [{ name: 'Content', path: root }])

    const savedBankRaw = sessionStorage.getItem(`scheduleBank:${selectedClientId}`)
    setBankFolder(savedBankRaw ? JSON.parse(savedBankRaw) : null)
  }, [clientName, selectedClientId])

  // Persist on every change, same as Content.jsx.
  useEffect(() => {
    if (selectedClientId && stack?.length) {
      sessionStorage.setItem(`schedulePath:${selectedClientId}`, stack[stack.length - 1].path)
    }
  }, [selectedClientId, stack])

  useEffect(() => {
    if (!selectedClientId) return
    if (bankFolder) sessionStorage.setItem(`scheduleBank:${selectedClientId}`, JSON.stringify(bankFolder))
    else sessionStorage.removeItem(`scheduleBank:${selectedClientId}`)
  }, [selectedClientId, bankFolder])

  const currentPath = stack?.[stack.length - 1]?.path

  useEffect(() => {
    if (currentPath) loadFolder(currentPath)
  }, [currentPath])

  async function loadFolder(path) {
    setLoading(true)
    setEntries([])
    setLoadError(false)
    try {
      const raw = await listDropboxFolder(path)
      const folders = raw.filter(e => e['.tag'] === 'folder')
      const files = raw.filter(e => e['.tag'] === 'file')
      const sorted = [
        ...folders.map(f => ({ ...f, type: 'folder' })),
        ...files.map(f => ({ ...f, type: getFileType(f.name) }))
      ]
      setEntries(sorted)

      // Preview links for image AND video files — both render a real
      // thumbnail (video via <video>, since browsers show its first frame
      // without needing a separate Dropbox thumbnail-generation call).
      // Capped at 40 so a huge folder doesn't fire 200 temporary-link
      // requests at once.
      const media = files.filter(f => ['photo', 'video'].includes(getFileType(f.name))).slice(0, 40)
      media.forEach(async f => {
        const link = await getDownloadLink(f.path_lower)
        if (link) setThumbs(prev => ({ ...prev, [f.path_lower]: link }))
      })
    } catch (err) {
      console.error('loadFolder error:', err)
      setLoadError(true)
    }
    setLoading(false)
  }

  function openFolder(folder) {
    setStack(prev => [...prev, { name: folder.name, path: folder.path_lower }])
  }

  function goToCrumb(index) {
    setStack(prev => prev.slice(0, index + 1))
  }

  const fileEntries = entries.filter(e => e.type !== 'folder')
  const folderEntries = entries.filter(e => e.type === 'folder')
  const viewingBank = bankFolder && currentPath === bankFolder.path

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Schedule</div>
        <div className={styles.sub}>Pick the quarter's content folder, then write captions and schedule the batch to Metricool.</div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.field} style={{ maxWidth: '320px', marginBottom: '4px' }}>
          <label className={styles.label}>Client</label>
          <select
            className={styles.input}
            value={selectedClientId || ''}
            onChange={e => setSelectedClientId(e.target.value)}
          >
            {allClients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {stack && (
        <>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', marginBottom: '14px', fontSize: '13px', color: 'var(--text2)' }}>
            {stack.map((crumb, i) => (
              <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {i > 0 && <i className="ti ti-chevron-right" style={{ fontSize: '12px', color: 'var(--text3)' }} aria-hidden="true" />}
                <button
                  onClick={() => goToCrumb(i)}
                  style={{
                    background: 'transparent', border: 'none', cursor: i === stack.length - 1 ? 'default' : 'pointer',
                    color: i === stack.length - 1 ? 'var(--text)' : 'var(--text2)',
                    fontWeight: i === stack.length - 1 ? 500 : 400, fontSize: '13px', padding: '2px 4px'
                  }}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>

          {/* Bank folder selection */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px',
            background: viewingBank ? 'var(--teal-bg)' : 'var(--surface2)',
            border: `1px solid ${viewingBank ? 'var(--teal)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: '18px'
          }}>
            <div style={{ fontSize: '13px', color: viewingBank ? 'var(--teal)' : 'var(--text2)' }}>
              {bankFolder
                ? <>Content bank: <strong>{bankFolder.name}</strong> ({fileEntries.length > 0 && viewingBank ? fileEntries.length : '…'} files)</>
                : 'Browse into the folder holding this quarter\'s content, then set it as the bank.'}
            </div>
            {stack.length > 1 && (
              <button
                className={styles.editBtn}
                onClick={() => setBankFolder({ name: stack[stack.length - 1].name, path: currentPath })}
                disabled={viewingBank}
              >
                <i className="ti ti-flag-3" aria-hidden="true" />
                {viewingBank ? 'This is the bank' : 'Set as content bank'}
              </button>
            )}
          </div>

          {/* Folder / file grid */}
          {loading ? (
            <div className={styles.empty}>Loading...</div>
          ) : loadError ? (
            <div className={styles.empty}>Couldn't load this folder. Try again.</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>Empty folder.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
              {folderEntries.map(f => (
                <div
                  key={f.path_lower}
                  onClick={() => openFolder(f)}
                  style={{ cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 12px', textAlign: 'center' }}
                >
                  <i className="ti ti-folder" style={{ fontSize: '28px', color: 'var(--gold-light)' }} aria-hidden="true" />
                  <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '8px', wordBreak: 'break-word' }}>{f.name}</div>
                </div>
              ))}
              {fileEntries.map(f => {
                const thumb = thumbs[f.path_lower]
                const { icon, bg, color } = fileIcon(f.name)
                return (
                  <div key={f.path_lower} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <div style={{ aspectRatio: '1', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {thumb && f.type === 'photo' && (
                        <img src={thumb} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {thumb && f.type === 'video' && (
                        <video src={thumb} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {(!thumb || (f.type !== 'photo' && f.type !== 'video')) && (
                        <i className={`ti ${icon}`} style={{ fontSize: '28px', color }} aria-hidden="true" />
                      )}
                    </div>
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '11.5px', color: 'var(--text)', wordBreak: 'break-word', lineHeight: 1.3 }}>{f.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '3px' }}>{formatBytes(f.size)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {bankFolder && viewingBank && fileEntries.length > 0 && (
        <div className={styles.empty} style={{ marginTop: '24px', padding: '28px 24px' }}>
          <i className="ti ti-writing" style={{ fontSize: '24px', color: 'var(--text3)', marginBottom: '10px', display: 'block' }} aria-hidden="true" />
          Next: a caption, platforms, and a date for each of these {fileEntries.length} files — then one Schedule button to send the whole batch to Metricool with the right tracked link in each caption.
        </div>
      )}
    </div>
  )
}
