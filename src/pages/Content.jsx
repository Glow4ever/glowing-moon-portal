import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Content.module.css'

const periods = ['Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Archive']

function periodToPath(p) { return p.replace(' ', '-').toLowerCase() }

function fileType(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['mp4','mov','avi','webm'].includes(ext)) return 'video'
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'photo'
  return 'other'
}

export default function Content() {
  const [activePeriod, setActivePeriod] = useState('Q2 2026')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const fileRef = useRef()

  useEffect(() => { loadFiles(activePeriod) }, [activePeriod])

  async function loadFiles(period) {
    setLoading(true)
    setFiles([])
    const path = `content/${periodToPath(period)}`
    const { data, error } = await supabase.storage.from('portal-assets').list(path, { sortBy: { column: 'created_at', order: 'desc' } })
    if (!error && data) {
      const filtered = data.filter(f => f.name !== '.keep')
      const withUrls = filtered.map(f => {
        const { data: urlData } = supabase.storage.from('portal-assets').getPublicUrl(`${path}/${f.name}`)
        return { ...f, url: urlData.publicUrl, type: fileType(f.name) }
      })
      setFiles(withUrls)
    }
    setLoading(false)
  }

  async function handleUpload(e) {
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    setUploading(true)
    for (const file of selected) {
      const path = `content/${periodToPath(activePeriod)}/${file.name}`
      await supabase.storage.from('portal-assets').upload(path, file, { upsert: true })
    }
    await loadFiles(activePeriod)
    setUploading(false)
  }

  const photos = files.filter(f => f.type === 'photo')
  const videos = files.filter(f => f.type === 'video')
  const others = files.filter(f => f.type === 'other')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Content Library</h1>
          <p className={styles.sub}>Photo and video assets organised by period</p>
        </div>
        <div>
          <input type="file" ref={fileRef} style={{ display:'none' }} multiple accept="image/*,video/*" onChange={handleUpload} />
          <button className="btn btn-gold" onClick={() => fileRef.current.click()} disabled={uploading}>
            <i className="ti ti-upload" aria-hidden="true" /> {uploading ? 'Uploading...' : 'Upload Assets'}
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        {periods.map(p => (
          <button key={p} className={`${styles.tab} ${activePeriod === p ? styles.tabActive : ''}`} onClick={() => setActivePeriod(p)}>{p}</button>
        ))}
      </div>

      {loading && <div className={styles.empty}>Loading assets...</div>}

      {!loading && files.length === 0 && (
        <div className={styles.emptyState}>
          <i className="ti ti-photo-off" style={{ fontSize:'36px', color:'var(--text3)', marginBottom:'12px' }} aria-hidden="true" />
          <div style={{ fontSize:'14px', color:'var(--text2)', marginBottom:'4px' }}>No assets for {activePeriod} yet</div>
          <div style={{ fontSize:'12px', color:'var(--text3)' }}>Upload photos and videos using the button above</div>
        </div>
      )}

      {photos.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Photos ({photos.length})</div>
          <div className={styles.mediaGrid}>
            {photos.map(f => (
              <div key={f.id} className={styles.thumb} onClick={() => setLightbox(f)}>
                <img src={f.url} alt={f.name} className={styles.thumbImg} />
                <div className={styles.thumbOverlay}><i className="ti ti-eye" aria-hidden="true" /></div>
                <div className={styles.thumbLabel}>{f.name}</div>
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
                <video src={f.url} className={styles.thumbImg} preload="metadata" muted />
                <div className={styles.thumbOverlay}><i className="ti ti-player-play" aria-hidden="true" /></div>
                <div className={styles.thumbLabel}>{f.name}</div>
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
              <div key={f.id} className={styles.thumb} onClick={() => window.open(f.url, '_blank')}>
                <div className={styles.thumbFile}><i className="ti ti-file" style={{ fontSize:'28px', color:'var(--text3)' }} aria-hidden="true" /></div>
                <div className={styles.thumbOverlay}><i className="ti ti-download" aria-hidden="true" /></div>
                <div className={styles.thumbLabel}>{f.name}</div>
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
