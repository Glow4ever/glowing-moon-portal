import { useState, useEffect, useRef, useCallback } from 'react'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
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

const PLATFORMS = [
  { key: 'facebook',  label: 'Facebook',  icon: 'ti-brand-facebook' },
  { key: 'instagram', label: 'Instagram', icon: 'ti-brand-instagram' },
  { key: 'linkedin',  label: 'LinkedIn',  icon: 'ti-brand-linkedin' },
  { key: 'youtube',   label: 'YouTube',   icon: 'ti-brand-youtube' },
]

const SAVE_DEBOUNCE_MS = 900

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
  if (!path || !path.toLowerCase().startsWith(root.toLowerCase())) return null
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

// Local datetime input <-> ISO helpers. <input type="datetime-local">
// works in the browser's local time with no timezone info attached, so
// this just needs to be internally consistent, not timezone-aware — the
// actual scheduling step (not built yet) is what will need to reason
// about the client's real timezone when this becomes a Metricool call.
function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInputValue(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

export default function Schedule() {
  // Client selection is global, not page-local — same client the rest of
  // the portal is looking at, switched via the Topbar's "Switch Client"
  // control. An earlier version of this page kept its own local
  // selectedClientId state, which looked fine but was never actually
  // wired to the real active client: picking a client here only updated
  // this page's own state, so on any remount (e.g. switching browser tabs
  // and back) it reset to whatever the real global client still was —
  // GMM, since that's the default and nothing had ever really changed it.
  const { client } = useClient()
  const clientName = client?.name
  const selectedClientId = client?.id

  const [stack, setStack] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const [bankFolder, setBankFolder] = useState(null) // the folder chosen as "this quarter's bank"

  // drafts keyed by dropbox_path (path_lower) — one entry per file, holding
  // both the row's db id (once it exists) and its current field values.
  const [drafts, setDrafts] = useState({})
  const [savingPaths, setSavingPaths] = useState({}) // path -> 'saving' | 'saved'
  const saveTimers = useRef({})

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

  // Load existing draft rows for the bank folder whenever it's the one
  // being viewed — this is what makes revisiting a folder show whatever
  // captions/platforms/dates were already saved, rather than starting
  // blank every time.
  useEffect(() => {
    if (!viewingBank || !selectedClientId || !bankFolder) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('schedule_drafts')
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('bank_folder_path', bankFolder.path)
      if (cancelled) return
      const map = {}
      ;(data || []).forEach(row => { map[row.dropbox_path] = row })
      setDrafts(map)
    })()
    return () => { cancelled = true }
  }, [viewingBank, selectedClientId, bankFolder?.path])

  function draftFor(file) {
    return drafts[file.path_lower] || {
      id: null,
      client_id: selectedClientId,
      bank_folder_path: bankFolder?.path,
      dropbox_path: file.path_lower,
      filename: file.name,
      caption: '',
      platforms: [],
      publish_date: null,
      status: 'draft'
    }
  }

  // Local state updates immediately (so typing feels instant); the actual
  // write is debounced per-file so a fast typist doesn't fire a network
  // request on every keystroke. Upserts on (client_id, dropbox_path), so
  // revisiting a file that already has a draft just updates that same row.
  function updateDraft(file, patch) {
    const path = file.path_lower
    setDrafts(prev => ({
      ...prev,
      [path]: { ...draftFor(file), ...prev[path], ...patch }
    }))
    setSavingPaths(prev => ({ ...prev, [path]: 'pending' }))

    clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(() => saveDraft(file, path), SAVE_DEBOUNCE_MS)
  }

  const saveDraft = useCallback(async (file, path) => {
    setSavingPaths(prev => ({ ...prev, [path]: 'saving' }))
    setDrafts(current => {
      const row = current[path]
      supabase
        .from('schedule_drafts')
        .upsert({
          id: row.id || undefined,
          client_id: row.client_id,
          bank_folder_path: row.bank_folder_path,
          dropbox_path: row.dropbox_path,
          filename: row.filename,
          caption: row.caption,
          first_comment: row.first_comment || null,
          platforms: row.platforms,
          publish_date: row.publish_date,
        }, { onConflict: 'client_id,dropbox_path' })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error('saveDraft error:', error)
            setSavingPaths(prev => ({ ...prev, [path]: 'error' }))
            return
          }
          if (data) setDrafts(prev => ({ ...prev, [path]: { ...prev[path], id: data.id } }))
          setSavingPaths(prev => ({ ...prev, [path]: 'saved' }))
        })
      return current
    })
  }, [])

  function togglePlatform(file, key) {
    const current = draftFor(file).platforms || []
    const next = current.includes(key) ? current.filter(p => p !== key) : [...current, key]
    updateDraft(file, { platforms: next })
  }

  const readyCount = fileEntries.filter(f => {
    const d = draftFor(f)
    return d.caption?.trim() && d.platforms?.length > 0 && d.publish_date
  }).length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Schedule</div>
        <div className={styles.sub}>Pick the quarter's content folder, then write captions and schedule the batch to Metricool.</div>
      </div>

      <div className={styles.formCard} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <i className="ti ti-building-store" style={{ fontSize: '16px', color: 'var(--gold-light)' }} aria-hidden="true" />
        <div style={{ fontSize: '13px', color: 'var(--text)' }}>
          Scheduling for <strong>{clientName || '…'}</strong>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text3)' }}>— use "Switch Client" in the top bar to change this</div>
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
                ? <>Content bank: <strong>{bankFolder.name}</strong>{viewingBank && fileEntries.length > 0 && <> — {readyCount} of {fileEntries.length} ready to schedule</>}</>
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

          {loading ? (
            <div className={styles.empty}>Loading...</div>
          ) : loadError ? (
            <div className={styles.empty}>Couldn't load this folder. Try again.</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>Empty folder.</div>
          ) : viewingBank ? (
            /* Composer — one row per file: caption, platforms, date */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {fileEntries.map(f => {
                const d = draftFor(f)
                const thumb = thumbs[f.path_lower]
                const { icon, bg, color } = fileIcon(f.name)
                const saveState = savingPaths[f.path_lower]
                return (
                  <div key={f.path_lower} style={{ display: 'flex', gap: '14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px' }}>
                    <div style={{ width: '84px', height: '84px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {thumb && f.type === 'photo' && <img src={thumb} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {thumb && f.type === 'video' && <video src={thumb} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {(!thumb || (f.type !== 'photo' && f.type !== 'video')) && <i className={`ti ${icon}`} style={{ fontSize: '24px', color }} aria-hidden="true" />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', wordBreak: 'break-word' }}>{f.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>
                          {saveState === 'saving' && 'Saving…'}
                          {saveState === 'saved' && <span style={{ color: 'var(--teal)' }}><i className="ti ti-check" aria-hidden="true" /> Saved</span>}
                          {saveState === 'error' && <span style={{ color: 'var(--coral)' }}>Couldn't save</span>}
                          {saveState === 'pending' && '…'}
                        </div>
                      </div>

                      <textarea
                        className={styles.input}
                        placeholder="Write the caption once — it goes out with the right tracked link per platform."
                        value={d.caption}
                        onChange={e => updateDraft(f, { caption: e.target.value })}
                        rows={2}
                        style={{ resize: 'vertical', fontFamily: 'inherit' }}
                      />

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          {PLATFORMS.map(p => {
                            const active = (d.platforms || []).includes(p.key)
                            return (
                              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: active ? 'var(--text)' : 'var(--text3)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={active} onChange={() => togglePlatform(f, p.key)} />
                                <i className={`ti ${p.icon}`} aria-hidden="true" />
                                {p.label}
                              </label>
                            )
                          })}
                        </div>
                        <input
                          type="datetime-local"
                          className={styles.input}
                          style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                          value={toLocalInputValue(d.publish_date)}
                          onChange={e => updateDraft(f, { publish_date: fromLocalInputValue(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Plain folder browser — not viewing the bank yet */
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
                      {thumb && f.type === 'photo' && <img src={thumb} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {thumb && f.type === 'video' && <video src={thumb} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {(!thumb || (f.type !== 'photo' && f.type !== 'video')) && <i className={`ti ${icon}`} style={{ fontSize: '28px', color }} aria-hidden="true" />}
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

      {viewingBank && fileEntries.length > 0 && (
        <div className={styles.empty} style={{ marginTop: '24px', padding: '22px 24px' }}>
          <i className="ti ti-send" style={{ fontSize: '22px', color: 'var(--text3)', marginBottom: '8px', display: 'block' }} aria-hidden="true" />
          Captions save automatically as you go — {readyCount} of {fileEntries.length} have a caption, at least one platform, and a date. The Schedule button that sends the whole batch to Metricool is the next piece to build.
        </div>
      )}
    </div>
  )
}
