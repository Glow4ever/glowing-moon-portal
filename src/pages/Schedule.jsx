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
  { key: 'tiktok',    label: 'TikTok',    icon: 'ti-brand-tiktok' },
  { key: 'youtube',   label: 'YouTube',   icon: 'ti-brand-youtube' },
]

// Confirmed live against this account's real post history (see
// api/metricool-analytics.js and the Schedule build notes for how these
// were verified). Only YouTube's "short" type, IG's POST/REEL, FB's POST,
// and TikTok's PUBLIC_TO_EVERYONE were seen on an actual published post --
// the rest of each list is Metricool's/the platform's standard set, not
// independently confirmed. Scoped to Shorts only for YouTube: long-form
// video always goes up natively outside this tool, regardless of whether
// everything else here routes through Metricool, so there's no long-form
// option to build.
const IG_POST_TYPES = [
  { value: 'POST', label: 'Post' },
  { value: 'REEL', label: 'Reel' },
  { value: 'STORY', label: 'Story' },
  { value: 'TRIAL_REEL', label: 'Trial Reel' },
]
// Facebook has no hard restriction the way Instagram does -- a short video
// posts fine as either, so this is a real creative choice, not a
// requirement.
const FB_POST_TYPES = [
  { value: 'POST', label: 'Post' },
  { value: 'REEL', label: 'Reel' },
]
const YT_PRIVACY = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
]
const YT_CATEGORIES = [
  'FILM_ANIMATION', 'AUTOS_VEHICLES', 'MUSIC', 'PETS_ANIMALS', 'SPORTS',
  'GAMING', 'PEOPLE_BLOGS', 'COMEDY', 'ENTERTAINMENT', 'NEWS_POLITICS',
  'HOWTO_STYLE', 'EDUCATION', 'SCIENCE_TECHNOLOGY', 'NONPROFITS_ACTIVISM',
]
const TIKTOK_PRIVACY = [
  { value: 'PUBLIC_TO_EVERYONE', label: 'Public' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends' },
  { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
  { value: 'SELF_ONLY', label: 'Private' },
]

// Kept short and specific to where GMM and its clients actually are,
// rather than a full IANA list -- this is a quick picker, not a settings
// page.
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'Europe/Madrid', label: 'Central European (Madrid)' },
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

// A lit toggle instead of a bare checkbox -- glows when active, matching
// the "mix console" feel the composer's aiming for now that there are
// enough switches on a row to actually feel like a panel of them.
function ToggleSwitch({ checked, onChange, label, icon }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '12px', color: checked ? 'var(--text)' : 'var(--text3)' }}>
      <span style={{
        position: 'relative', width: '30px', height: '17px', borderRadius: '10px', flexShrink: 0,
        background: checked ? 'var(--teal)' : 'var(--surface2)',
        border: '1px solid ' + (checked ? 'var(--teal)' : 'var(--border)'),
        boxShadow: checked ? '0 0 9px var(--teal), 0 0 2px var(--teal)' : 'none',
        transition: 'background 0.15s ease, box-shadow 0.15s ease'
      }}>
        <span style={{
          position: 'absolute', top: '1px', left: checked ? '14px' : '1px',
          width: '13px', height: '13px', borderRadius: '50%',
          background: checked ? '#fff' : 'var(--text3)',
          boxShadow: checked ? '0 0 4px rgba(255,255,255,0.9)' : 'none',
          transition: 'left 0.15s ease'
        }} />
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      {label}
    </label>
  )
}

// Thumbnail selection, kept deliberately light: no frame extraction, no
// filmstrip of pre-generated options -- just the real <video> element
// scrubbed via currentTime, which the browser already renders as a live
// frame while dragging. Reuses the same temporary Dropbox link already
// fetched for the file's preview thumbnail, so there's no new backend
// work here at all. This gets most of the value of a proper scrubber
// (see and pick the exact moment) without the heavier build a filmstrip
// picker would need (seeking to N points, drawing each to a canvas,
// handling seek failures) -- worth revisiting only if picking blind ever
// turns out to be a real friction point.
function formatMs(ms) {
  const s = Math.floor((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function VideoCoverPicker({ videoUrl, valueMs, onChange }) {
  const [open, setOpen] = useState(false)
  const [duration, setDuration] = useState(0)
  const [scrubMs, setScrubMs] = useState(valueMs || 0)
  const videoRef = useRef(null)

  useEffect(() => { setScrubMs(valueMs || 0) }, [valueMs])

  function handleLoadedMetadata() {
    const durMs = (videoRef.current?.duration || 0) * 1000
    setDuration(durMs)
    if (videoRef.current) videoRef.current.currentTime = (valueMs || 0) / 1000
  }

  function handleScrub(e) {
    const ms = Number(e.target.value)
    setScrubMs(ms)
    if (videoRef.current) videoRef.current.currentTime = ms / 1000
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: '11px', cursor: 'pointer', padding: '4px 9px', borderRadius: '5px', width: 'fit-content' }}
      >
        <i className="ti ti-crop" aria-hidden="true" />
        {valueMs != null ? `Cover at ${formatMs(valueMs)}` : 'Set cover'}
      </button>
    )
  }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '260px' }}>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        style={{ width: '100%', borderRadius: '6px', display: 'block', background: '#000' }}
      />
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={100}
        value={scrubMs}
        onChange={handleScrub}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10.5px', color: 'var(--text3)' }}>{formatMs(scrubMs)} / {formatMs(duration)}</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => { onChange(Math.round(scrubMs)); setOpen(false) }}
            style={{ background: 'var(--teal)', border: 'none', color: '#04211d', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px 10px', borderRadius: '5px' }}
          >
            Use this frame
          </button>
        </div>
      </div>
    </div>
  )
}

// publish_date is stored exactly as typed into the datetime-local input --
// a wall-clock string like "2026-09-30T23:38", no timezone math applied --
// paired with an explicit timezone field. This deliberately mirrors what
// Metricool's own API expects for publicationDate (verified live: a real
// scheduled post's publicationDate was {dateTime: "2026-09-30T23:38:00",
// timezone: "America/New_York"}, not a UTC instant). "11:38 PM Eastern"
// stored as literally that, plus "America/New_York", never needs
// converting -- it never has to mean anything else in between.

export default function Schedule() {
  const restoredForClient = useRef(null)
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
  const [trackedLinks, setTrackedLinks] = useState([])
  const [activeCaptionTab, setActiveCaptionTab] = useState({}) // path -> 'template' | platform key
  const [linkBankOpenFor, setLinkBankOpenFor] = useState(null) // path or null
  const [copiedLinkId, setCopiedLinkId] = useState(null)

  // The client's tracked links -- one small fetch per client, reused
  // across every row's link bank rather than queried per file.
  useEffect(() => {
    if (!selectedClientId) return
    supabase
      .from('tracked_links')
      .select('id, platform, slug, label')
      .eq('client_id', selectedClientId)
      .then(({ data }) => setTrackedLinks(data || []))
  }, [selectedClientId])
  const saveTimers = useRef({})
  const tempKeyCounter = useRef(0)

  // Restore the last-viewed folder (and bank selection) for this client
  // instead of always resetting to Content root. This page can remount —
  // e.g. switching browser tabs away and back — and without this, that
  // silently drops you back at the top of the folder tree every time.
  // Same pattern Content.jsx already uses, same reason.
  // Restore once per genuine client change, guarded by a ref rather than
  // re-running on every render where clientName/selectedClientId happen to
  // get recomputed with the same value. Without the guard, any incidental
  // re-render (e.g. a context re-render on tab focus) could re-run this,
  // and — worse — the old version of this effect also had a paired
  // "persist on every bankFolder change" effect that would write bankFolder
  // straight to sessionStorage on ANY change, including a transient one.
  // If bankFolder ever flickered null for a render, that effect would
  // immediately overwrite the real saved value with a removal. Persistence
  // is now deliberate instead: written only where bankFolder is explicitly
  // set (the "Set as content bank" click below), never as a side effect of
  // a bare state change.
  useEffect(() => {
    if (!clientName || !selectedClientId) return
    if (restoredForClient.current === selectedClientId) return
    restoredForClient.current = selectedClientId

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

  function setBank(folder) {
    setBankFolder(folder)
    if (selectedClientId) sessionStorage.setItem(`scheduleBank:${selectedClientId}`, JSON.stringify(folder))
  }

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
        .order('created_at', { ascending: true })
      if (cancelled) return
      // A file can have any number of postings over its life -- R001 on
      // FB/IG Monday, then LinkedIn Tuesday, then retired -- so drafts is
      // keyed by path to an ARRAY of occurrences, not a single row. _key
      // is a client-side identity (the real db id once saved, a temp-N
      // key before that) used for React keys and for targeting updates;
      // it's never itself persisted.
      const map = {}
      ;(data || []).forEach(row => {
        if (!map[row.dropbox_path]) map[row.dropbox_path] = []
        map[row.dropbox_path].push({ ...row, _key: row.id })
      })
      setDrafts(map)
    })()
    return () => { cancelled = true }
  }, [viewingBank, selectedClientId, bankFolder?.path])

  function occurrencesFor(file) {
    return drafts[file.path_lower] || []
  }

  function blankOccurrence(file, key) {
    return {
      _key: key,
      id: null,
      client_id: selectedClientId,
      bank_folder_path: bankFolder?.path,
      dropbox_path: file.path_lower,
      filename: file.name,
      caption: '',
      platform_captions: {},
      platforms: [],
      publish_date: null,
      timezone: 'America/New_York',
      status: 'draft',
      active: true,
      ig_post_type: 'POST',
      ig_show_reel_on_feed: true,
      fb_post_type: 'POST',
      yt_title: '',
      yt_privacy: 'public',
      yt_made_for_kids: false,
      yt_category: '',
      tiktok_privacy: 'PUBLIC_TO_EVERYONE',
      video_cover_ms: null,
      media_alt_text: '',
    }
  }

  function addOccurrence(file) {
    const key = `temp-${tempKeyCounter.current++}`
    setDrafts(prev => ({
      ...prev,
      [file.path_lower]: [...(prev[file.path_lower] || []), blankOccurrence(file, key)]
    }))
    setActiveCaptionTab(prev => ({ ...prev, [key]: 'template' }))
  }

  // Local state updates immediately (so typing feels instant); the actual
  // write is debounced per-occurrence so a fast typist doesn't fire a
  // network request on every keystroke.
  function updateOccurrence(file, occKey, patch) {
    setDrafts(prev => ({
      ...prev,
      [file.path_lower]: (prev[file.path_lower] || []).map(occ =>
        occ._key === occKey ? { ...occ, ...patch } : occ
      )
    }))
    setSavingPaths(prev => ({ ...prev, [occKey]: 'pending' }))

    clearTimeout(saveTimers.current[occKey])
    saveTimers.current[occKey] = setTimeout(() => saveOccurrence(file, occKey), SAVE_DEBOUNCE_MS)
  }

  const saveOccurrence = useCallback(async (file, occKey) => {
    setSavingPaths(prev => ({ ...prev, [occKey]: 'saving' }))
    setDrafts(current => {
      const list = current[file.path_lower] || []
      const row = list.find(o => o._key === occKey)
      if (!row) return current

      const payload = {
        client_id: row.client_id,
        bank_folder_path: row.bank_folder_path,
        dropbox_path: row.dropbox_path,
        filename: row.filename,
        caption: row.caption,
        platform_captions: row.platform_captions || {},
        platforms: row.platforms,
        publish_date: row.publish_date,
        timezone: row.timezone || 'America/New_York',
        active: row.active ?? true,
        ig_post_type: row.ig_post_type || 'POST',
        ig_show_reel_on_feed: row.ig_show_reel_on_feed ?? true,
        fb_post_type: row.fb_post_type || 'POST',
        yt_title: row.yt_title || null,
        yt_privacy: row.yt_privacy || 'public',
        yt_made_for_kids: row.yt_made_for_kids ?? false,
        yt_category: row.yt_category || null,
        tiktok_privacy: row.tiktok_privacy || 'PUBLIC_TO_EVERYONE',
        video_cover_ms: row.video_cover_ms ?? null,
        media_alt_text: row.media_alt_text || null,
      }
      // A real id -> update that exact row. No id yet (a fresh occurrence
      // from "+ Add a posting") -> plain insert, since dropbox_path is no
      // longer unique and can't be used as an upsert target anymore.
      const query = row.id
        ? supabase.from('schedule_drafts').update(payload).eq('id', row.id)
        : supabase.from('schedule_drafts').insert(payload)

      query.select().single().then(({ data, error }) => {
        if (error) {
          console.error('saveOccurrence error:', error)
          setSavingPaths(prev => ({ ...prev, [occKey]: 'error' }))
          return
        }
        if (data) {
          setDrafts(prev => ({
            ...prev,
            [file.path_lower]: (prev[file.path_lower] || []).map(o =>
              o._key === occKey ? { ...o, id: data.id } : o
            )
          }))
        }
        setSavingPaths(prev => ({ ...prev, [occKey]: 'saved' }))
      })
      return current
    })
  }, [])

  // Deactivating is immediate, not debounced -- it's a deliberate discrete
  // action ("this one's done"), not something that benefits from waiting
  // to see if the user keeps typing.
  function toggleActive(file, occKey, active) {
    updateOccurrence(file, occKey, { active })
    clearTimeout(saveTimers.current[occKey])
    saveOccurrence(file, occKey)
  }

  // Safety net independent of the debounce timer: if the tab is hidden —
  // switched away from, not just scrolled past — flush every pending save
  // immediately rather than trusting the 900ms timer to still be alive by
  // the time it fires. A setTimeout doesn't get cancelled by a backgrounded
  // tab, but it can lose a race against the tab being reclaimed, and losing
  // the one caption someone just finished typing is a bad trade for saving
  // one network call.
  useEffect(() => {
    function flushOnHide() {
      if (document.visibilityState !== 'hidden') return
      Object.entries(saveTimers.current).forEach(([occKey, timerId]) => {
        clearTimeout(timerId)
        const file = fileEntries.find(f =>
          (drafts[f.path_lower] || []).some(o => o._key === occKey)
        )
        if (file) saveOccurrence(file, occKey)
      })
    }
    document.addEventListener('visibilitychange', flushOnHide)
    return () => document.removeEventListener('visibilitychange', flushOnHide)
  }, [fileEntries, drafts, saveOccurrence])

  function togglePlatform(file, occKey, current, key) {
    const next = current.includes(key) ? current.filter(p => p !== key) : [...current, key]
    updateOccurrence(file, occKey, { platforms: next })
  }

  // Counted across active OCCURRENCES now, not files -- a file with two
  // postings contributes two to the total. Deactivated postings (their
  // lifespan is over) don't count toward either number.
  const allOccurrences = fileEntries.flatMap(f => occurrencesFor(f).map(occ => ({ file: f, occ })))
  const activeOccurrences = allOccurrences.filter(({ occ }) => occ.active !== false)
  const readyCount = activeOccurrences.filter(({ occ }) =>
    occ.caption?.trim() && occ.platforms?.length > 0 && occ.publish_date
  ).length

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
                ? <>Content bank: <strong>{bankFolder.name}</strong>{viewingBank && activeOccurrences.length > 0 && <> — {readyCount} of {activeOccurrences.length} ready to schedule</>}</>
                : 'Browse into the folder holding this quarter\'s content, then set it as the bank.'}
            </div>
            {stack.length > 1 && (
              <button
                className={styles.editBtn}
                onClick={() => setBank({ name: stack[stack.length - 1].name, path: currentPath })}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {fileEntries.map(f => {
                const thumb = thumbs[f.path_lower]
                const { icon, bg, color } = fileIcon(f.name)
                const occurrences = occurrencesFor(f)
                // Fully retired: has at least one posting and every one of
                // them is inactive. Lets you scan the bank for what's
                // already been used without opening each file -- the
                // point being to bounce around a folder out of order and
                // still know at a glance what's spoken for.
                const fullyRetired = occurrences.length > 0 && occurrences.every(o => o.active === false)
                const anyPublished = occurrences.some(o => o.status === 'published')
                return (
                  <div key={f.path_lower} style={{ display: 'flex', gap: '14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px' }}>
                    <div style={{ position: 'relative', width: '84px', height: '84px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {thumb && f.type === 'photo' && <img src={thumb} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: fullyRetired ? 'grayscale(85%) brightness(0.55)' : 'none' }} />}
                      {thumb && f.type === 'video' && <video src={thumb} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: fullyRetired ? 'grayscale(85%) brightness(0.55)' : 'none' }} />}
                      {(!thumb || (f.type !== 'photo' && f.type !== 'video')) && <i className={`ti ${icon}`} style={{ fontSize: '24px', color, opacity: fullyRetired ? 0.4 : 1 }} aria-hidden="true" />}
                      {fullyRetired && (
                        <div style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', borderRadius: '50%', background: anyPublished ? 'var(--teal)' : 'var(--surface1)', border: '1px solid ' + (anyPublished ? 'var(--teal)' : 'var(--border)'), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: anyPublished ? '0 0 6px var(--teal)' : 'none' }}>
                          <i className="ti ti-check" style={{ fontSize: '11px', color: anyPublished ? '#fff' : 'var(--text3)' }} aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text2)', wordBreak: 'break-word' }}>{f.name}</div>

                      {/* The same file can have any number of independent
                          postings over its life -- FB/IG Monday, LinkedIn
                          Tuesday, then retired -- so this is a list of
                          occurrences, not a single form. Each occurrence
                          saves, schedules, and deactivates on its own. */}
                      {occurrences.map(occ => {
                        const d = occ
                        const saveState = savingPaths[occ._key]
                        const isActive = occ.active !== false
                        return (
                          <div key={occ._key} style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface1)', border: '1px solid ' + (isActive ? 'var(--border)' : 'transparent'), borderRadius: '8px', padding: '10px 12px', opacity: isActive ? 1 : 0.55 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <ToggleSwitch
                                checked={isActive}
                                onChange={e => toggleActive(f, occ._key, e.target.checked)}
                                label={isActive ? 'Active' : 'Retired'}
                              />
                              <div style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>
                                {saveState === 'saving' && 'Saving…'}
                                {saveState === 'saved' && <span style={{ color: 'var(--teal)' }}><i className="ti ti-check" aria-hidden="true" /> Saved</span>}
                                {saveState === 'error' && <span style={{ color: 'var(--coral)' }}>Couldn't save</span>}
                                {saveState === 'pending' && '…'}
                              </div>
                            </div>

                      {/* Template + per-network overrides, matching
                          Metricool's own "Edit by network" pattern rather
                          than inventing a different one. Template is what
                          every checked platform uses by default; switching
                          to a platform's own tab and typing creates a real
                          override for just that platform, without touching
                          the template or any other platform's copy. */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          {[{ key: 'template', label: 'Template', icon: 'ti-template' }, ...PLATFORMS.filter(p => (d.platforms || []).includes(p.key))].map(tab => {
                            const isTemplate = tab.key === 'template'
                            const tabActive = (activeCaptionTab[occ._key] || 'template') === tab.key
                            const hasOverride = !isTemplate && d.platform_captions?.[tab.key] !== undefined
                            return (
                              <button
                                key={tab.key}
                                onClick={() => setActiveCaptionTab(prev => ({ ...prev, [occ._key]: tab.key }))}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '4px',
                                  background: tabActive ? 'var(--surface1)' : 'transparent',
                                  border: '1px solid ' + (tabActive ? 'var(--border)' : 'transparent'),
                                  borderBottom: tabActive ? '1px solid var(--surface1)' : '1px solid transparent',
                                  color: tabActive ? 'var(--text)' : 'var(--text3)',
                                  borderRadius: '6px 6px 0 0', padding: '4px 10px', fontSize: '11px', cursor: 'pointer'
                                }}
                              >
                                {!isTemplate && <i className={`ti ${tab.icon}`} aria-hidden="true" />}
                                {isTemplate ? 'Template' : tab.label}
                                {hasOverride && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--teal)', display: 'inline-block' }} />}
                              </button>
                            )
                          })}
                        </div>

                        {(() => {
                          const tab = activeCaptionTab[occ._key] || 'template'
                          const isTemplate = tab === 'template'
                          const value = isTemplate ? d.caption : (d.platform_captions?.[tab] ?? d.caption)
                          const hasOverride = !isTemplate && d.platform_captions?.[tab] !== undefined
                          return (
                            <div style={{ position: 'relative' }}>
                              <textarea
                                className={styles.input}
                                placeholder={isTemplate ? 'Write the caption once — each platform uses this unless you customize it.' : `Customize the caption for this platform…`}
                                value={value}
                                onChange={e => {
                                  if (isTemplate) {
                                    updateOccurrence(f, occ._key, { caption: e.target.value })
                                  } else {
                                    updateOccurrence(f, occ._key, { platform_captions: { ...(d.platform_captions || {}), [tab]: e.target.value } })
                                  }
                                }}
                                rows={2}
                                style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
                              />
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                <div>
                                  {hasOverride && (
                                    <button
                                      onClick={() => {
                                        const next = { ...(d.platform_captions || {}) }
                                        delete next[tab]
                                        updateOccurrence(f, occ._key, { platform_captions: next })
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: '11px', cursor: 'pointer', padding: 0 }}
                                    >
                                      Reset to template
                                    </button>
                                  )}
                                </div>
                                <div style={{ position: 'relative' }}>
                                  <button
                                    onClick={() => setLinkBankOpenFor(prev => prev === occ._key ? null : occ._key)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: '11px', cursor: 'pointer', padding: '3px 8px', borderRadius: '5px' }}
                                  >
                                    <i className="ti ti-link" aria-hidden="true" />
                                    Link bank
                                  </button>
                                  {linkBankOpenFor === occ._key && (
                                    <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px', zIndex: 10, minWidth: '220px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                                    {trackedLinks.length === 0 ? (
                                      <div style={{ fontSize: '11px', color: 'var(--text3)', padding: '6px 8px' }}>No tracked links for this client yet.</div>
                                    ) : trackedLinks.map(link => {
                                      const url = `https://linkquick.org/go/${link.slug}`
                                      const justCopied = copiedLinkId === link.id
                                      return (
                                        <button
                                          key={link.id}
                                          onClick={() => {
                                            navigator.clipboard.writeText(url)
                                            setCopiedLinkId(link.id)
                                            setTimeout(() => setCopiedLinkId(null), 1500)
                                          }}
                                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '11.5px', cursor: 'pointer', padding: '6px 8px', borderRadius: '5px' }}
                                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'capitalize' }}>
                                            <i className={`ti ti-brand-${link.platform}`} style={{ fontSize: '12px', color: 'var(--text3)' }} aria-hidden="true" />
                                            {link.label || link.platform}
                                          </span>
                                          <span style={{ fontSize: '10.5px', color: justCopied ? 'var(--teal)' : 'var(--text3)' }}>
                                            {justCopied ? 'Copied' : 'Copy'}
                                          </span>
                                        </button>
                                      )
                                    })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })()}
                      </div>

                      {/* Each platform is one self-contained vertical unit --
                          checkbox on top, that platform's own settings
                          directly beneath it in the same block. This is
                          deliberate: an earlier version rendered the
                          checkboxes in one row and the settings panels in
                          a second row below, declared in a different order
                          than the checkboxes -- so the two rows didn't
                          line up and the settings visually crossed over
                          to the wrong platform depending on which boxes
                          were checked. Gluing each platform's settings to
                          its own checkbox means there's no second row to
                          fall out of sync with the first; it can't
                          misalign because there's nothing separate to
                          misalign. */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
                        {PLATFORMS.map(p => {
                          const active = (d.platforms || []).includes(p.key)
                          return (
                            <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <ToggleSwitch
                                checked={active}
                                onChange={() => togglePlatform(f, occ._key, d.platforms || [], p.key)}
                                icon={p.icon}
                                label={p.label}
                              />

                              {active && p.key === 'instagram' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '20px' }}>
                                  <select
                                    className={styles.input}
                                    style={{ width: 'auto', padding: '4px 6px', fontSize: '11.5px' }}
                                    value={d.ig_post_type}
                                    onChange={e => updateOccurrence(f, occ._key, { ig_post_type: e.target.value })}
                                  >
                                    {IG_POST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                  {d.ig_post_type === 'REEL' && (
                                    <ToggleSwitch
                                      checked={d.ig_show_reel_on_feed}
                                      onChange={e => updateOccurrence(f, occ._key, { ig_show_reel_on_feed: e.target.checked })}
                                      label="Show on feed"
                                    />
                                  )}
                                </div>
                              )}

                              {active && p.key === 'facebook' && (
                                <div style={{ paddingLeft: '20px' }}>
                                  <select
                                    className={styles.input}
                                    style={{ width: 'auto', padding: '4px 6px', fontSize: '11.5px' }}
                                    value={d.fb_post_type}
                                    onChange={e => updateOccurrence(f, occ._key, { fb_post_type: e.target.value })}
                                  >
                                    {FB_POST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                </div>
                              )}

                              {active && p.key === 'tiktok' && (
                                <div style={{ paddingLeft: '20px' }}>
                                  <select
                                    className={styles.input}
                                    style={{ width: 'auto', padding: '4px 6px', fontSize: '11.5px' }}
                                    value={d.tiktok_privacy}
                                    onChange={e => updateOccurrence(f, occ._key, { tiktok_privacy: e.target.value })}
                                  >
                                    {TIKTOK_PRIVACY.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                </div>
                              )}

                              {active && p.key === 'youtube' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '20px', maxWidth: '360px' }}>
                                  <span style={{ fontSize: '10.5px', color: 'var(--text3)', background: 'var(--surface1)', padding: '2px 6px', borderRadius: '4px', width: 'fit-content' }}>Short</span>
                                  <input
                                    type="text"
                                    className={styles.input}
                                    placeholder="Title (required by YouTube)"
                                    value={d.yt_title}
                                    onChange={e => updateOccurrence(f, occ._key, { yt_title: e.target.value })}
                                    style={{ padding: '4px 8px', fontSize: '11.5px' }}
                                  />
                                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    <select
                                      className={styles.input}
                                      style={{ width: 'auto', padding: '4px 6px', fontSize: '11.5px' }}
                                      value={d.yt_privacy}
                                      onChange={e => updateOccurrence(f, occ._key, { yt_privacy: e.target.value })}
                                    >
                                      {YT_PRIVACY.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                    <select
                                      className={styles.input}
                                      style={{ width: 'auto', padding: '4px 6px', fontSize: '11.5px' }}
                                      value={d.yt_category}
                                      onChange={e => updateOccurrence(f, occ._key, { yt_category: e.target.value })}
                                    >
                                      <option value="">Category…</option>
                                      {YT_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                                    </select>
                                  </div>
                                  <ToggleSwitch
                                    checked={d.yt_made_for_kids}
                                    onChange={e => updateOccurrence(f, occ._key, { yt_made_for_kids: e.target.checked })}
                                    label="Made for kids"
                                  />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {f.type === 'video' && thumbs[f.path_lower] && (
                        <VideoCoverPicker
                          videoUrl={thumbs[f.path_lower]}
                          valueMs={d.video_cover_ms}
                          onChange={ms => updateOccurrence(f, occ._key, { video_cover_ms: ms })}
                        />
                      )}

                      {/* Date/timezone are not platform-specific, so they sit
                          on their own row rather than inside any platform's
                          column. */}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '4px' }}>
                        <input
                          type="datetime-local"
                          className={styles.input}
                          style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                          value={d.publish_date || ''}
                          onChange={e => updateOccurrence(f, occ._key, { publish_date: e.target.value || null })}
                        />
                        <select
                          className={styles.input}
                          style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                          value={d.timezone || 'America/New_York'}
                          onChange={e => updateOccurrence(f, occ._key, { timezone: e.target.value })}
                        >
                          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                        </select>
                      </div>
                          </div>
                        )
                      })}

                      <button
                        onClick={() => addOccurrence(f)}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start', background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text3)', fontSize: '11.5px', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px' }}
                      >
                        <i className="ti ti-plus" aria-hidden="true" />
                        {occurrences.length === 0 ? 'Add a posting' : 'Add another posting'}
                      </button>
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

      {viewingBank && activeOccurrences.length > 0 && (
        <div className={styles.empty} style={{ marginTop: '24px', padding: '22px 24px' }}>
          <i className="ti ti-send" style={{ fontSize: '22px', color: 'var(--text3)', marginBottom: '8px', display: 'block' }} aria-hidden="true" />
          Captions save automatically as you go — {readyCount} of {activeOccurrences.length} active postings have a caption, at least one platform, and a date. The Schedule button that sends the whole batch to Metricool is the next piece to build.
        </div>
      )}
    </div>
  )
}
