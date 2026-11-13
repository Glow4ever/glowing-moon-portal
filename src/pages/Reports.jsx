import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch'
import styles from './Admin.module.css'

// Report drafts, moved out of Admin so editors can use them. Database
// policy decides what each person can see: admin sees every draft, an
// editor sees only drafts for clients they manage. Nothing auto-sends.
export default function Reports() {
  const [reportDrafts, setReportDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingDraft, setEditingDraft] = useState(null)
  const [draftText, setDraftText] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { loadReportDrafts() }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function loadReportDrafts() {
    setLoading(true)
    const { data } = await supabase
      .from('client_report_drafts')
      .select('*, clients(name, notification_email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setReportDrafts(data || [])
    setLoading(false)
  }

  function openDraftForReview(draft) {
    setEditingDraft(draft)
    setDraftText(draft.draft_content)
  }

  async function sendReportDraft() {
    if (!editingDraft) return
    if (draftText.includes('[YOUR SUMMARY')) {
      showToast('Write your summary first: replace the [YOUR SUMMARY] line')
      return
    }
    setSending(true)
    const client = editingDraft.clients

    // Logged into the same visible history a client already sees and
    // trusts: mid-month notes and month-in-reviews show up the same way
    // press mentions and qualitative wins already do.
    await supabase.from('client_log_entries').insert({
      client_id: editingDraft.client_id,
      entry_type: editingDraft.report_type === 'mid_month' ? 'mid_month_note' : 'month_in_review',
      entry_date: new Date().toISOString().slice(0, 10),
      title: editingDraft.report_type === 'mid_month' ? 'Two-week note' : 'Month in review',
      note: draftText,
      client_visible: true
    })

    if (client?.notification_email) {
      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'client_report',
          notificationEmail: client.notification_email,
          reportType: editingDraft.report_type,
          content: draftText
        })
      })
    }

    const { error } = await supabase.from('client_report_drafts').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      draft_content: draftText
    }).eq('id', editingDraft.id)

    if (error) {
      showToast('Sent, but the draft could not be marked sent. Tell Hector.')
    } else {
      showToast('Sent!')
    }
    setReportDrafts(prev => prev.filter(d => d.id !== editingDraft.id))
    setEditingDraft(null)
    setSending(false)
  }

  async function cancelReportDraft(draft) {
    if (!window.confirm('Cancel this draft? The portal won\'t re-prompt until the next real due date.')) return
    await supabase.from('client_report_drafts').update({ status: 'cancelled' }).eq('id', draft.id)
    setReportDrafts(prev => prev.filter(d => d.id !== draft.id))
    setEditingDraft(null)
  }

  const typeLabel = t => (t === 'mid_month' ? 'Two-week note' : 'Month in review')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
        <p className={styles.sub}>Review, edit and send. Nothing goes to a client until you click Send.</p>
      </div>

      <div className={styles.sectionLabel}>Pending Reports</div>
      {loading && <div className={styles.empty}>Loading...</div>}
      {!loading && reportDrafts.length === 0 && (
        <div className={styles.empty}>Nothing pending. Drafts show up here as they come due.</div>
      )}
      {reportDrafts.map(draft => (
        <div key={draft.id} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '16px 20px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text1)' }}>{draft.clients?.name}</span>
            <span style={{ fontSize: '12px', background: 'var(--gold-bg)', color: 'var(--gold-light)', padding: '3px 10px', borderRadius: '20px' }}>
              {typeLabel(draft.report_type)}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
            {draft.period_start} to {draft.period_end}
          </div>
          <button className="btn btn-gold" onClick={() => openDraftForReview(draft)} style={{ fontSize: '13px' }}>
            Review &amp; Send
          </button>
        </div>
      ))}

      {editingDraft && (
        <div
          onClick={() => setEditingDraft(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface1)', border: '0.5px solid var(--border)', borderRadius: '14px', padding: '24px', maxWidth: '520px', width: '90%' }}
          >
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text1)', marginBottom: '4px' }}>
              {typeLabel(editingDraft.report_type)}: {editingDraft.clients?.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
              Edit freely before sending. This goes out exactly as written below.
            </div>
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              rows={12}
              style={{ width: '100%', background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '8px', padding: '12px', fontSize: '14px', lineHeight: '1.6', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => cancelReportDraft(editingDraft)}
                style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', padding: '9px 16px', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }}
              >
                Cancel this draft
              </button>
              <button
                onClick={() => setEditingDraft(null)}
                style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', padding: '9px 16px', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }}
              >
                Close
              </button>
              <button
                className="btn btn-gold"
                onClick={sendReportDraft}
                disabled={sending}
                style={{ fontSize: '13px' }}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: 'var(--surface3)', border: '1px solid var(--border2)', color: 'var(--text)', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', zIndex: 1000 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
