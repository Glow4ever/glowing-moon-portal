import { useState, useEffect } from 'react'
import { useClient } from '../lib/ClientContext'
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

export default function Schedule() {
  const { client, allClients, role, switchClient } = useClient()
  const [selectedClientId, setSelectedClientId] = useState(client?.id || null)

  useEffect(() => {
    if (!selectedClientId && allClients.length > 0) {
      setSelectedClientId(allClients[0].id)
    }
  }, [allClients])

  const selectedClient = allClients.find(c => c.id === selectedClientId)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Schedule</div>
        <div className={styles.sub}>Batch-schedule a folder of content across platforms, with the right tracked link in each caption.</div>
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

      <div className={styles.empty} style={{ padding: '48px 32px' }}>
        <i className="ti ti-calendar-plus" style={{ fontSize: '28px', color: 'var(--text3)', marginBottom: '12px', display: 'block' }} aria-hidden="true" />
        Batch scheduling for {selectedClient?.name || 'this client'} isn't built yet.
        <br />
        Next: pick a Dropbox folder, write captions once, choose platforms and dates, and schedule the whole batch to Metricool in one pass — with each platform's tracked link inserted automatically.
      </div>
    </div>
  )
}
