import { logAction } from '../lib/audit'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useClient } from '../lib/ClientContext'
import { reconcileClientCounts } from '../lib/fileCounts'
import styles from './Admin.module.css'
import { apiFetch } from '../lib/apiFetch'

export default function Admin() {
  const { allClients, updateClientBranding, loadUserContext, switchClient } = useClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('clients')
  const [teamMembers, setTeamMembers] = useState([])
  const [trackerRollup, setTrackerRollup] = useState({})
  const [cyclesByClient, setCyclesByClient] = useState({})
  const [attentionQueue, setAttentionQueue] = useState([])
  const [activityFeed, setActivityFeed] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', primary_color: '#D3C9A7', secondary_color: '#2B2B2E' })
  const [newMember, setNewMember] = useState({ email: '', password: '', client_id: '', role: 'member' })
  const [clientPortalRole, setClientPortalRole] = useState('member')
  const [editingClient, setEditingClient] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [auditLogs, setAuditLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [reportDrafts, setReportDrafts] = useState([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [editingDraft, setEditingDraft] = useState(null)
  const [trackedLinks, setTrackedLinks] = useState([])
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [newLink, setNewLink] = useState({ client_id: '', slug: '', destination_url: '', label: '', platform: '' })
  const [editingLink, setEditingLink] = useState(null)
  const [savingLinkEdit, setSavingLinkEdit] = useState(false)
  const [savingLink, setSavingLink] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [sendingDraft, setSendingDraft] = useState(false)
  const [resyncing, setResyncing] = useState({})
  const [trackerOpen, setTrackerOpen] = useState(null)
  const [settingStatus, setSettingStatus] = useState(false)
  const [breakerOpenCycle, setBreakerOpenCycle] = useState(null)
  const didResetBrand = useRef(false)

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, b => chars[b % chars.length]).join('')
  }

  useEffect(() => { loadTeam(); loadTrackerRollup(); loadAttentionQueue(); loadActivityFeed(); loadCyclesByClient() }, [])

  // Reset the active-client branding to GMM whenever the Admin panel mounts,
  // so opening a client folder themes to them but returning here is neutral.
  useEffect(() => {
    if (didResetBrand.current || !allClients?.length) return
    const gmm = allClients.find(c => c.slug === 'glowing-moon-media')
    if (gmm) { switchClient(gmm.id); didResetBrand.current = true }
  }, [allClients])

  async function loadTeam() {
    const { data } = await supabase
      .from('user_roles')
      .select('*, clients(name)')
      .order('created_at')
    if (data) setTeamMembers(data)
  }

  async function loadTrackerRollup() {
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('client_id, status'),
      supabase.from('file_comments').select('client_id, file_path, sender_role').eq('resolved', false)
    ])

    const rollup = {}

    ;(statusRows || []).forEach(r => {
      if (!rollup[r.client_id]) rollup[r.client_id] = { approved: 0, in_review: 0, revision: 0 }
      if (r.status === 'approved') rollup[r.client_id].approved++
      else rollup[r.client_id].in_review++
    })

    // revision overrides in_review — count unique file paths with unresolved
    // CLIENT comments only. Admin's own notes are informational, not a
    // signal that this client is waiting on a revision.
    const revisionByClient = {}
    ;(commentRows || []).forEach(r => {
      if (r.sender_role === 'admin') return
      if (!revisionByClient[r.client_id]) revisionByClient[r.client_id] = new Set()
      revisionByClient[r.client_id].add(r.file_path)
    })
    Object.entries(revisionByClient).forEach(([clientId, paths]) => {
      if (!rollup[clientId]) rollup[clientId] = { approved: 0, in_review: 0, revision: 0 }
      rollup[clientId].revision = paths.size
      // Those revision files were counted as in_review — subtract them
      rollup[clientId].in_review = Math.max(0, rollup[clientId].in_review - paths.size)
    })

    setTrackerRollup(rollup)
  }

  async function loadCyclesByClient() {
    const { data: cycleRows } = await supabase
      .from('review_cycles')
      .select('*')
      .is('resolved_at', null)
      .order('sent_at', { ascending: false })

    if (!cycleRows || cycleRows.length === 0) { setCyclesByClient({}); return }

    const cycleIds = cycleRows.map(c => c.id)
    const [{ data: statusRows }, { data: commentRows }] = await Promise.all([
      supabase.from('file_status').select('cycle_id, status').in('cycle_id', cycleIds),
      supabase.from('file_comments').select('cycle_id, sender_role').in('cycle_id', cycleIds).eq('resolved', false)
    ])

    // Only unresolved CLIENT comments should mark a cycle as needing
    // revisions — an admin note left alongside a send-for-review is
    // informational, and an already-resolved comment shouldn't still be
    // blocking anything either. This query previously had neither filter.
    const revisionCycles = new Set(
      (commentRows || []).filter(r => r.sender_role !== 'admin').map(r => r.cycle_id)
    )
    const rollupByCycle = {}
    ;(statusRows || []).forEach(r => {
      if (!rollupByCycle[r.cycle_id]) rollupByCycle[r.cycle_id] = { approved: 0, in_review: 0 }
      if (r.status === 'approved') rollupByCycle[r.cycle_id].approved++
      else rollupByCycle[r.cycle_id].in_review++
    })

    const grouped = {}
    cycleRows.forEach(cycle => {
      const roll = rollupByCycle[cycle.id] || { approved: 0, in_review: 0 }
      const hasRevisions = revisionCycles.has(cycle.id)
      // Same formula as recomputeCycleStage in Content.jsx — kept identical
      // on purpose so Admin and the member-facing Overview never disagree.
      let derivedStage = 'in_review'
      if (hasRevisions) derivedStage = 'revisions'
      else if (roll.approved > 0 && roll.in_review === 0) derivedStage = 'approved'
      const effectiveStage = cycle.manual_override || derivedStage
      if (!grouped[cycle.client_id]) grouped[cycle.client_id] = []
      grouped[cycle.client_id].push({ ...cycle, derivedStage, effectiveStage, roll })
    })
    setCyclesByClient(grouped)
  }

  async function loadAttentionQueue() {
    const WAITING_THRESHOLD_DAYS = 3

    const [{ data: pendingClients }, { data: commentRows }, { data: pendingReports }] = await Promise.all([
      supabase.from('clients').select('id, name, approval_status, approval_sent_at').eq('approval_status', 'pending'),
      supabase.from('file_comments').select('client_id, file_path, sender_role, created_at').order('created_at', { ascending: true }),
      supabase.from('client_report_drafts').select('id, client_id, report_type').eq('status', 'pending')
    ])

    const items = []

    // Waiting on client — review sent, no response in N+ days
    ;(pendingClients || []).forEach(c => {
      if (!c.approval_sent_at) return
      const days = Math.floor((Date.now() - new Date(c.approval_sent_at).getTime()) / (1000 * 60 * 60 * 24))
      if (days >= WAITING_THRESHOLD_DAYS) {
        items.push({ type: 'waiting_client', clientId: c.id, clientName: c.name, days })
      }
    })

    // Waiting on admin — client's revision note is the latest message in its thread, no reply yet
    const lastMessageByThread = {}
    ;(commentRows || []).forEach(r => {
      lastMessageByThread[`${r.client_id}::${r.file_path}`] = r
    })
    const waitingOnAdminByClient = {}
    Object.values(lastMessageByThread).forEach(r => {
      if (r.sender_role !== 'admin') {
        waitingOnAdminByClient[r.client_id] = (waitingOnAdminByClient[r.client_id] || 0) + 1
      }
    })
    Object.entries(waitingOnAdminByClient).forEach(([clientId, count]) => {
      const c = allClients.find(cl => cl.id === clientId)
      items.push({ type: 'waiting_admin', clientId, clientName: c?.name || 'A client', count })
    })

    // Report ready — a mid-month note or month-in-review has been assembled
    // and is waiting on admin to review, edit, and send.
    ;(pendingReports || []).forEach(r => {
      const c = allClients.find(cl => cl.id === r.client_id)
      items.push({
        type: 'report_ready',
        clientId: r.client_id,
        clientName: c?.name || 'A client',
        reportType: r.report_type
      })
    })

    setAttentionQueue(items)
  }

  async function loadActivityFeed() {
    setActivityLoading(true)

    function relativeTime(dateStr) {
      const diffMs = Date.now() - new Date(dateStr).getTime()
      const mins = Math.floor(diffMs / 60000)
      if (mins < 1) return 'just now'
      if (mins < 60) return `${mins} min ago`
      const hours = Math.floor(mins / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      if (days === 1) return 'Yesterday'
      return `${days} days ago`
    }

    const [{ data: uploadLogs }, { data: approvedRows }, { data: commentRows }, { data: sentClients }] = await Promise.all([
      supabase.from('audit_logs').select('client_id, user_email, details, created_at').eq('action', 'upload').order('created_at', { ascending: false }).limit(20),
      supabase.from('file_status').select('client_id, updated_at').eq('status', 'approved').order('updated_at', { ascending: false }).limit(50),
      supabase.from('file_comments').select('client_id, file_path, sender_role, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('id, name, approval_sent_at, approval_month').not('approval_sent_at', 'is', null)
    ])

    const clientName = (id) => allClients.find(c => c.id === id)?.name || 'A client'
    const events = []

    ;(uploadLogs || []).forEach(l => {
      events.push({
        color: 'var(--text3)',
        title: `${l.details?.count || ''} file${l.details?.count !== 1 ? 's' : ''} uploaded${l.details?.folder ? ` to ${l.details.folder}` : ''}`,
        subtitle: clientName(l.client_id),
        time: l.created_at
      })
    })

    // Group approvals by client + same calendar day
    const approvalGroups = {}
    ;(approvedRows || []).forEach(r => {
      const day = r.updated_at.slice(0, 10)
      const key = `${r.client_id}::${day}`
      if (!approvalGroups[key]) approvalGroups[key] = { client_id: r.client_id, count: 0, latest: r.updated_at }
      approvalGroups[key].count++
      if (r.updated_at > approvalGroups[key].latest) approvalGroups[key].latest = r.updated_at
    })
    Object.values(approvalGroups).forEach(g => {
      events.push({
        color: 'var(--teal)',
        title: `${g.count} file${g.count !== 1 ? 's' : ''} approved`,
        subtitle: clientName(g.client_id),
        time: g.latest
      })
    })

    ;(commentRows || []).forEach(r => {
      const fileName = r.file_path.split('/').pop()
      events.push({
        color: '#F0997B',
        title: r.sender_role === 'admin' ? `You replied on ${fileName}` : `Revision note on ${fileName}`,
        subtitle: r.sender_role === 'admin' ? clientName(r.client_id) : `${clientName(r.client_id)} · awaiting your reply`,
        time: r.created_at
      })
    })

    ;(sentClients || []).forEach(c => {
      events.push({
        color: 'var(--gold-light)',
        title: `${c.approval_month || 'Content'} sent for review`,
        subtitle: c.name,
        time: c.approval_sent_at
      })
    })

    events.sort((a, b) => new Date(b.time) - new Date(a.time))
    setActivityFeed(events.slice(0, 15).map(e => ({ ...e, relativeTime: relativeTime(e.time) })))
    setActivityLoading(false)
  }

  async function removeTeamMember(member) {
    if (member.role === 'admin') return showToast('Cannot remove admin accounts from here')
    const confirmed = window.confirm(`Remove portal access for ${member.email || 'this user'}? This deletes their login entirely — they'll need to be re-invited to regain access.`)
    if (!confirmed) return
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: member.user_id }
    })
    if (error || data?.error) {
      let message = 'Failed to remove user.'
      try {
        const body = await error?.context?.json()
        if (body?.error) message = body.error
      } catch {}
      if (data?.error) message = data.error
      showToast(message)
      return
    }
    await supabase.from('user_roles').delete().eq('id', member.id)
    await loadTeam()
    showToast('Portal access removed')
  }

  async function loadAuditLogs() {
    setLoadingLogs(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (data) setAuditLogs(data)
    setLoadingLogs(false)
  }

  async function loadComments() {
    setLoadingComments(true)
    const { data } = await supabase
      .from('file_comments')
      .select('*, clients(name, primary_color)')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
    if (data) setComments(data)
    setLoadingComments(false)
  }

  async function dismissComment(comment) {
    // Marks resolved rather than deleting — the note stays in the folder's
    // permanent history (visible from Content Library), it just drops off
    // this "needs attention" queue and stops blocking the cycle's approval.
    await supabase.from('file_comments').update({ resolved: true }).eq('id', comment.id)
    setComments(prev => prev.filter(c => c.id !== comment.id))

    // Resolving a revision note can change the cycle's derived stage back
    // toward in_review or approved — without this, the tracker keeps showing
    // "revisions" even after the note is resolved.
    if (comment.cycle_id) {
      const [{ data: statusRows }, { data: remainingComments }] = await Promise.all([
        supabase.from('file_status').select('status').eq('cycle_id', comment.cycle_id),
        supabase.from('file_comments').select('id, sender_role').eq('cycle_id', comment.cycle_id).eq('resolved', false)
      ])
      const clientRemaining = (remainingComments || []).filter(r => r.sender_role !== 'admin')
      let recomputed = 'in_review'
      if (clientRemaining.length > 0) recomputed = 'revisions'
      else if ((statusRows || []).length > 0 && statusRows.every(r => r.status === 'approved')) recomputed = 'approved'
      await supabase.from('review_cycles').update({ stage: recomputed }).eq('id', comment.cycle_id)
      await loadCyclesByClient()
    }
  }

  async function loadReportDrafts() {
    setLoadingReports(true)
    const { data } = await supabase
      .from('client_report_drafts')
      .select('*, clients(name, notification_email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setReportDrafts(data || [])
    setLoadingReports(false)
  }

  function openDraftForReview(draft) {
    setEditingDraft(draft)
    setDraftText(draft.draft_content)
  }

  async function sendReportDraft() {
    if (!editingDraft) return
    setSendingDraft(true)
    const client = editingDraft.clients

    // Logged into the same visible history a client already sees and
    // trusts — mid-month notes and month-in-reviews show up the same way
    // press mentions and qualitative wins already do.
    await supabase.from('client_log_entries').insert({
      client_id: editingDraft.client_id,
      entry_type: editingDraft.report_type === 'mid_month' ? 'mid_month_note' : 'month_in_review',
      entry_date: new Date().toISOString().slice(0, 10),
      title: editingDraft.report_type === 'mid_month' ? 'Mid-month note' : 'Month in review',
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

    await supabase.from('client_report_drafts').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      draft_content: draftText
    }).eq('id', editingDraft.id)

    setReportDrafts(prev => prev.filter(d => d.id !== editingDraft.id))
    setEditingDraft(null)
    showToast('Sent!')
    setSendingDraft(false)
  }

  async function cancelReportDraft(draft) {
    if (!window.confirm('Cancel this draft? The portal won\'t re-prompt until the next real due date.')) return
    await supabase.from('client_report_drafts').update({ status: 'cancelled' }).eq('id', draft.id)
    setReportDrafts(prev => prev.filter(d => d.id !== draft.id))
  }

  async function loadTrackedLinks() {
    setLoadingLinks(true)
    const { data: links } = await supabase
      .from('tracked_links')
      .select('*, clients(name)')
      .order('created_at', { ascending: false })
    const { data: clickRows } = await supabase.from('link_clicks').select('link_id')
    const clickCounts = {}
    ;(clickRows || []).forEach(r => { clickCounts[r.link_id] = (clickCounts[r.link_id] || 0) + 1 })
    setTrackedLinks((links || []).map(l => ({ ...l, clickCount: clickCounts[l.id] || 0 })))
    setLoadingLinks(false)
  }

  async function createTrackedLink() {
    if (!newLink.client_id || !newLink.slug || !newLink.destination_url) {
      return showToast('Client, slug, and destination URL are all required')
    }
    setSavingLink(true)
    const cleanSlug = newLink.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const { error } = await supabase.from('tracked_links').insert({
      client_id: newLink.client_id,
      slug: cleanSlug,
      destination_url: newLink.destination_url.trim(),
      label: newLink.label.trim() || null,
      platform: newLink.platform || null
    })
    if (error) {
      showToast(error.code === '23505' ? 'That slug is already taken — try another' : 'Could not create link')
    } else {
      setNewLink({ client_id: '', slug: '', destination_url: '', label: '', platform: '' })
      await loadTrackedLinks()
      try {
        await navigator.clipboard.writeText(`https://linkquick.org/go/${cleanSlug}`)
        showToast('Link created and copied!')
      } catch {
        showToast('Link created!')
      }
    }
    setSavingLink(false)
  }

  function startEditingLink(link) {
    setEditingLink({
      id: link.id,
      originalSlug: link.slug,
      slug: link.slug,
      destination_url: link.destination_url,
      label: link.label || '',
      platform: link.platform || ''
    })
  }

  async function saveEditedLink() {
    if (!editingLink.slug || !editingLink.destination_url) {
      return showToast('Slug and destination URL are both required')
    }
    const cleanSlug = editingLink.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const slugChanged = cleanSlug !== editingLink.originalSlug
    if (slugChanged && !window.confirm(
      `You're changing this link's actual URL from /go/${editingLink.originalSlug} to /go/${cleanSlug}. ` +
      `If the old link is already pasted anywhere live (a caption, a bio, a post), it will stop working the moment you save. Continue?`
    )) {
      return
    }
    setSavingLinkEdit(true)
    const { error } = await supabase.from('tracked_links').update({
      slug: cleanSlug,
      destination_url: editingLink.destination_url.trim(),
      label: editingLink.label.trim() || null,
      platform: editingLink.platform || null
    }).eq('id', editingLink.id)
    if (error) {
      showToast(error.code === '23505' ? 'That slug is already taken — try another' : 'Could not save changes')
    } else {
      setEditingLink(null)
      await loadTrackedLinks()
      showToast('Link updated!')
    }
    setSavingLinkEdit(false)
  }

  async function deleteTrackedLink(link) {
    if (!window.confirm(`Delete this link? Existing click history for "${link.label || link.slug}" will be lost.`)) return
    await supabase.from('tracked_links').delete().eq('id', link.id)
    setTrackedLinks(prev => prev.filter(l => l.id !== link.id))
  }

  async function copyTrackedLink(link) {
    // Domain hardcoded here since tracked_links has no domain field of its
    // own — update this if the short-link domain ever changes.
    const fullUrl = `https://linkquick.org/go/${link.slug}`
    try {
      await navigator.clipboard.writeText(fullUrl)
      showToast('Link copied!')
    } catch (err) {
      showToast('Could not copy — try selecting it manually')
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function resyncFiles(client) {
    setResyncing(p => ({ ...p, [client.id]: true }))
    const { assetCount, contentCount } = await reconcileClientCounts(client.id, client.name)
    await loadUserContext()
    showToast(`${client.name} resynced — ${assetCount} assets, ${contentCount} content files`)
    setResyncing(p => ({ ...p, [client.id]: false }))
  }

  async function onboardClient() {
    if (!newClient.name.trim()) return
    setSaving(true)
    const slug = newClient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const { data: clientData, error: clientError } = await supabase.from('clients').insert({
      name: newClient.name.trim(),
      slug,
      primary_color: newClient.primary_color,
      secondary_color: newClient.secondary_color,
      active: true
    }).select().single()
    if (clientError) {
      showToast('Failed to create client.')
      setSaving(false)
      return
    }
    if (newMember.email) {
      const password = newMember.password || generatePassword()
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: newMember.email,
          password,
          client_id: clientData.id,
          role: clientPortalRole
        }
      })
      if (error || data?.error) {
        let message = 'Client created but user account failed. Add manually.'
        try {
          const body = await error?.context?.json()
          if (body?.error) message = `Client created, but: ${body.error}`
        } catch {}
        if (data?.error) message = `Client created, but: ${data.error}`
        showToast(message)
        setSaving(false)
        return
      }
      await apiFetch('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({
          type: 'welcome',
          clientName: newClient.name.trim(),
          recipientEmail: newMember.email
        })
      })
    }
    setNewClient({ name: '', primary_color: '#D3C9A7', secondary_color: '#2B2B2E' })
    setNewMember({ email: '', password: '', client_id: '', role: 'member' })
    setClientPortalRole('member')
    await loadUserContext()
    await loadTeam()
    showToast('Client onboarded!')
    setSaving(false)
  }

  async function saveClientBranding() {
    if (!editingClient) return
    setSaving(true)
    const cleanedCadenceTargets = editingClient.cadence_targets
      ? Object.fromEntries(Object.entries(editingClient.cadence_targets).filter(([, v]) => v !== undefined && v !== null))
      : null
    await updateClientBranding(editingClient.id, {
      name: editingClient.name,
      primary_color: editingClient.primary_color,
      secondary_color: editingClient.secondary_color,
      notification_email: editingClient.notification_email || null,
      retainer_start_date: editingClient.retainer_start_date || null,
      cover_url: editingClient.cover_url || null,
      service_tier: editingClient.service_tier || null,
      mission_statement: editingClient.mission_statement || null,
      brand_pillars: editingClient.brand_pillars || null,
      cadence_targets: cleanedCadenceTargets && Object.keys(cleanedCadenceTargets).length > 0 ? cleanedCadenceTargets : null,
      time_recovered_hours: editingClient.time_recovered_hours ?? null,
      time_recovered_value: editingClient.time_recovered_value ?? null,
      cost_avoidance_amount: editingClient.cost_avoidance_amount ?? null,
      cost_avoidance_label: editingClient.cost_avoidance_label || null,
      roi_show_time_hours: !!editingClient.roi_show_time_hours,
      roi_show_time_value: !!editingClient.roi_show_time_value,
      roi_show_cost_avoidance: !!editingClient.roi_show_cost_avoidance,
    })
    setEditingClient(null)
    showToast('Branding saved!')
    setSaving(false)
  }

  function deriveStage(client) {
    const roll = trackerRollup[client.id]
    const hasFiles = !!roll
    const hasRevisions = (roll?.revision || 0) > 0
    if (client.approval_status === 'approved') return 'approved'
    if (hasRevisions) return 'revisions'
    if (client.approval_status === 'pending') return 'in_review'
    return hasFiles ? 'uploaded' : 'none'
  }

  async function setClientStatus(client, target) {
    const roll = trackerRollup[client.id] || { approved: 0, in_review: 0, revision: 0 }
    let message = ''
    if (target === 'none') {
      message = `Reset ${client.name} to neutral? This clears the review status and removes all file approvals and revision notes for this client.`
    } else if (target === 'approved') {
      message = `Mark ${client.name} as fully approved? This approves all ${roll.in_review + roll.revision} outstanding file${roll.in_review + roll.revision !== 1 ? 's' : ''} and clears any revision notes.`
    } else if (target === 'pending') {
      message = `Set ${client.name} back to in review? Files stay as they are — the client will see the review banner again.`
    } else if (target === 'revision') {
      message = `Flag ${client.name} as needing revisions?`
    }
    if (!window.confirm(message)) return

    setSettingStatus(true)
    try {
      if (target === 'none') {
        if (client.approval_month) {
          const yearMatch = client.approval_month.match(/\d{4}/)
          if (yearMatch) {
            const year = parseInt(yearMatch[0])
            const monthName = client.approval_month.replace(yearMatch[0], '').trim() || client.approval_month
            await supabase.from('content_months').update({ approval_status: null }).eq('client_id', client.id).eq('month', monthName).eq('year', year)
          }
        }
        await supabase.from('file_status').delete().eq('client_id', client.id)
        await supabase.from('file_comments').delete().eq('client_id', client.id)
        await supabase.from('clients').update({
          approval_status: null, approval_month: null, approval_folder_path: null, approval_sent_at: null, approval_due_date: null
        }).eq('id', client.id)
      } else if (target === 'approved') {
        await supabase.from('file_comments').delete().eq('client_id', client.id)
        await supabase.from('file_status').update({ status: 'approved' }).eq('client_id', client.id)
        await supabase.from('clients').update({ approval_status: 'approved' }).eq('id', client.id)
      } else {
        await supabase.from('clients').update({ approval_status: target }).eq('id', client.id)
      }
      await loadUserContext()
      await loadTrackerRollup()
      showToast(`${client.name} status updated`)
    } catch (err) {
      console.error('setClientStatus error:', err)
      showToast('Could not update status')
    }
    setSettingStatus(false)
  }

  // Hard reset — deletes the cycle entirely. file_status and file_comments
  // rows cascade-delete via their cycle_id foreign key. That's the only
  // reset action now — Clear Stage was cut, having a rollback that doesn't
  // visibly move the review banner or tracker made it more confusing than
  // useful in practice.
  async function clearCycle(cycle, client) {
    const confirmed = window.confirm(`Clear this review cycle for ${client.name} (${cycle.folder_label || cycle.folder_path})? This resets file approvals and status so you can start fresh. Revision notes stay visible in the folder's history and are not deleted.`)
    if (!confirmed) return
    setSettingStatus(true)
    await supabase.from('review_cycles').delete().eq('id', cycle.id)
    await loadCyclesByClient()
    setBreakerOpenCycle(null)
    showToast(`Cycle cleared for ${client.name}`)
    setSettingStatus(false)
  }

  async function clearReview(client) {
    const confirmed = window.confirm(`Clear the pending review for ${client.name}? This resets the full cycle — approvals, revision notes, and the "Pending Review" status all clear so you can start fresh.`)
    if (!confirmed) return

    // Reset the matching content_months row (drives the client's Overview panel)
    // before we lose the approval_month reference on the clients row.
    if (client.approval_month) {
      const yearMatch = client.approval_month.match(/\d{4}/)
      if (yearMatch) {
        const year = parseInt(yearMatch[0])
        const monthName = client.approval_month.replace(yearMatch[0], '').trim() || client.approval_month
        await supabase.from('content_months').update({ approval_status: null }).eq('client_id', client.id).eq('month', monthName).eq('year', year)
      }
    }

    await supabase.from('file_status').delete().eq('client_id', client.id)
    await supabase.from('file_comments').delete().eq('client_id', client.id)
    await supabase.from('clients').update({
      approval_status: null,
      approval_month: null,
      approval_folder_path: null,
      approval_sent_at: null,
      approval_due_date: null
    }).eq('id', client.id)
    await loadUserContext()
    await loadTrackerRollup()
    showToast(`Review cleared for ${client.name}`)
  }

  function getStatusBadge(status, client) {
    if (!status || status === 'none') return null
    const map = {
      pending: { bg: 'var(--gold-bg)', color: 'var(--gold-light)', label: 'Pending Review ×' },
      approved: { bg: 'var(--teal-bg)', color: 'var(--teal)', label: 'Approved' },
      revision: { bg: '#2a1a1a', color: '#ff6b6b', label: 'Revision Requested' }
    }
    const s = map[status]
    if (!s) return null
    if (status === 'pending' && client) {
      return (
        <span
          className={styles.teamBadge}
          onClick={() => clearReview(client)}
          style={{ background: s.bg, color: s.color, cursor: 'pointer' }}
          title="Click to clear pending review"
        >
          {s.label}
        </span>
      )
    }
    return <span className={styles.teamBadge} style={{ background: s.bg, color: s.color }}>{s.label}</span>
  }

  const commentsByClient = comments.reduce((acc, c) => {
    const name = c.clients?.name || 'Unknown'
    if (!acc[name]) acc[name] = { color: c.clients?.primary_color, items: [] }
    acc[name].items.push(c)
    return acc
  }, {})

  return (
    <div className={styles.page}>
      <style>{`
        @keyframes gmmStageSweep {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes gmmStagePulse {
          0%, 100% { box-shadow: 0 0 4px 0 var(--gmm-pulse); }
          50%      { box-shadow: 0 0 11px 1px var(--gmm-pulse); }
        }
      `}</style>

      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <p className={styles.sub}>Manage clients, branding, and team access</p>
      </div>

      <div className={styles.tabs}>
        {['clients','team','revisions','reports','links','audit'].map(t => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => {
              setTab(t)
              if (t === 'audit') loadAuditLogs()
              if (t === 'revisions') loadComments()
              if (t === 'reports') loadReportDrafts()
              if (t === 'links') loadTrackedLinks()
            }}
          >
            {t === 'clients' ? 'Clients' : t === 'team' ? 'Team Members' : t === 'revisions' ? 'Revisions' : t === 'reports' ? 'Reports' : t === 'links' ? 'Links' : 'Audit Log'}
          </button>
        ))}
      </div>

      {tab === 'clients' && (
        <>
          {attentionQueue.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <i className="ti ti-alert-circle" style={{ fontSize: '15px', color: 'var(--gold-light)' }} />
                <div className={styles.sectionLabel} style={{ marginBottom: 0 }}>Needs attention</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                {attentionQueue.map((item, i) => {
                  if (item.type === 'waiting_client') {
                    return (
                      <div key={i} style={{ background: 'var(--gold-bg)', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 0 16px 0 rgba(211,201,167,0.18)', border: '1px solid rgba(211,201,167,0.3)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--gold-light)', marginBottom: '4px' }}>Waiting on client</div>
                        <div style={{ fontSize: '13px', color: 'var(--text1)', lineHeight: '1.5' }}>
                          {item.clientName} hasn't responded in {item.days} day{item.days !== 1 ? 's' : ''}
                        </div>
                        <button
                          onClick={() => showToast('Nudge is coming soon')}
                          style={{ marginTop: '10px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Send nudge
                        </button>
                      </div>
                    )
                  }
                  if (item.type === 'waiting_admin') {
                    return (
                      <div key={i} style={{ background: '#2a1a1a', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 0 16px 0 rgba(240,153,123,0.15)', border: '1px solid rgba(240,153,123,0.3)' }}>
                        <div style={{ fontSize: '11px', color: '#F0997B', marginBottom: '4px' }}>Waiting on admin</div>
                        <div style={{ fontSize: '13px', color: 'var(--text1)', lineHeight: '1.5' }}>
                          {item.count} revision note{item.count !== 1 ? 's' : ''} unanswered for {item.clientName}
                        </div>
                        <button
                          onClick={() => setTrackerOpen(item.clientId)}
                          style={{ marginTop: '10px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Open tracker
                        </button>
                      </div>
                    )
                  }
                  if (item.type === 'report_ready') {
                    return (
                      <div key={i} style={{ background: 'var(--teal-bg)', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 0 16px 0 rgba(29,158,117,0.18)', border: '1px solid rgba(29,158,117,0.3)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--teal)', marginBottom: '4px' }}>Report ready</div>
                        <div style={{ fontSize: '13px', color: 'var(--text1)', lineHeight: '1.5' }}>
                          {item.reportType === 'mid_month' ? 'Mid-month note' : 'Month in review'} drafted for {item.clientName}
                        </div>
                        <button
                          onClick={() => { setTab('reports'); loadReportDrafts() }}
                          style={{ marginTop: '10px', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Review &amp; send
                        </button>
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )}

        <div className={styles.adminLayout}>
          <div>
            <div className={styles.sectionLabel}>Active Clients ({allClients.length})</div>
            <div className={styles.clientGrid}>
              {allClients.map(c => (
                <div
                  key={c.id}
                  className={styles.clientCard}
                  style={(cyclesByClient[c.id] || []).some(cy => cy.effectiveStage === 'in_review' || cy.effectiveStage === 'revisions') ? {
                    boxShadow: `0 0 40px 2px ${c.primary_color}44`,
                    border: `1px solid ${c.primary_color}55`
                  } : undefined}
                >
                  <div className={styles.clientCardMain}>
                    <div className={styles.clientSwatch} style={{ background: c.primary_color }} />
                    <div className={styles.clientInfo}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className={styles.clientName}>{c.name}</div>
                      </div>
                      <div className={styles.clientSlug}>/{c.slug}</div>
                      {(() => {
                        const clientCycles = cyclesByClient[c.id] || []
                        if (clientCycles.length === 0) {
                          return <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>No active review cycle</div>
                        }
                        const stageColor = { uploaded: 'var(--teal)', in_review: 'var(--gold-light)', revisions: '#F0997B', approved: 'var(--teal)' }
                        const urgency = { revisions: 0, in_review: 1, approved: 2, uploaded: 3 }
                        const mostUrgent = [...clientCycles].sort((a, b) => urgency[a.effectiveStage] - urgency[b.effectiveStage])[0]
                        return (
                          <div
                            onClick={() => setTrackerOpen(trackerOpen === c.id ? null : c.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '8px', cursor: 'pointer' }}
                          >
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: stageColor[mostUrgent.effectiveStage] }} />
                            <span style={{ fontSize: '11px', color: 'var(--text2)' }}>
                              {clientCycles.length} active cycle{clientCycles.length !== 1 ? 's' : ''}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>· click to view</span>
                          </div>
                        )
                      })()}
                    </div>
                    <div className={styles.clientActions} style={{ flexDirection: 'row', gap: '6px' }}>
                      <button
                        className={styles.editBtn}
                        onClick={() => setTrackerOpen(trackerOpen === c.id ? null : c.id)}
                        title="View and control production status"
                        style={trackerOpen === c.id ? { color: 'var(--gold-light)' } : undefined}
                      >
                        <i className="ti ti-chart-bar" aria-hidden="true" /> Tracker
                      </button>
                      <button
                        className={styles.editBtn}
                        onClick={() => resyncFiles(c)}
                        disabled={resyncing[c.id]}
                        title="Recount files from Dropbox after manual changes"
                      >
                        <i className={`ti ti-refresh${resyncing[c.id] ? ' spin' : ''}`} aria-hidden="true" /> {resyncing[c.id] ? 'Resyncing...' : 'Resync Files'}
                      </button>
                      <button
                        className={styles.editBtn}
                        onClick={() => { switchClient(c.id); navigate('/content') }}
                        title="Browse to the folder you want to submit and click Send for Review there"
                      >
                        <i className="ti ti-send" aria-hidden="true" /> Send for Review
                      </button>
                      <button className={styles.editBtn} onClick={() => setEditingClient({...c})}>
                        <i className="ti ti-pencil" aria-hidden="true" /> Edit
                      </button>
                    </div>
                  </div>

                  {trackerOpen === c.id && (() => {
                    const clientCycles = cyclesByClient[c.id] || []
                    const stageMeta = {
                      uploaded: { label: 'Uploaded', color: 'var(--teal)' },
                      in_review: { label: 'In review', color: 'var(--gold-light)' },
                      revisions: { label: 'Revisions', color: '#F0997B' },
                      approved: { label: 'Approved', color: 'var(--teal)' }
                    }
                    const stageOrder = ['uploaded', 'in_review', 'revisions', 'approved']

                    if (clientCycles.length === 0) {
                      return (
                        <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '14px', fontSize: '12px', color: 'var(--text3)' }}>
                          No active review cycle. Use Send for Review above to start one.
                        </div>
                      )
                    }

                    return (
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {clientCycles.map(cycle => {
                          const activeIdx = stageOrder.indexOf(cycle.effectiveStage)
                          const isOverridden = !!cycle.manual_override && cycle.manual_override !== cycle.derivedStage
                          const days = cycle.sent_at ? Math.floor((Date.now() - new Date(cycle.sent_at).getTime()) / (1000 * 60 * 60 * 24)) : null
                          const dueOverdue = cycle.due_date && cycle.effectiveStage !== 'approved' && new Date(cycle.due_date + 'T23:59:59') < new Date()

                          return (
                            <div key={cycle.id} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '9px', padding: '12px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={{ minWidth: '110px' }}>
                                  <div style={{ fontSize: '12px', color: 'var(--text1)', fontWeight: '500' }}>{cycle.folder_label || 'Untitled cycle'}</div>
                                  {isOverridden && (
                                    <div style={{ fontSize: '10px', color: 'var(--gold-light)', marginTop: '2px' }}>manually overridden</div>
                                  )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', width: '150px', flexShrink: 0 }}>
                                  {stageOrder.map((key, i) => {
                                    const s = stageMeta[key]
                                    const filled = activeIdx >= i && activeIdx !== -1
                                    const isActive = activeIdx === i
                                    return (
                                      <span key={key} style={{
                                        height: '4px', flex: '1 1 0', minWidth: 0,
                                        borderRadius: i === 0 ? '2px 0 0 2px' : i === stageOrder.length - 1 ? '0 2px 2px 0' : 0,
                                        background: isActive
                                          ? `linear-gradient(90deg, ${s.color} 0%, ${s.color} 38%, rgba(255,255,255,0.65) 50%, ${s.color} 62%, ${s.color} 100%)`
                                          : filled ? s.color : 'var(--border)',
                                        backgroundSize: isActive ? '220% 100%' : '100% 100%',
                                        animation: isActive ? 'gmmStageSweep 2.4s linear infinite, gmmStagePulse 2.4s ease-in-out infinite' : 'none',
                                        '--gmm-pulse': s.color
                                      }} />
                                    )
                                  })}
                                </div>
                                <span style={{ fontSize: '11px', color: stageMeta[cycle.effectiveStage]?.color, whiteSpace: 'nowrap' }}>
                                  {stageMeta[cycle.effectiveStage]?.label}{days !== null ? ` · ${days}d` : ''}
                                </span>

                                {cycle.due_date && (
                                  <span style={{ fontSize: '11px', color: dueOverdue ? '#F0997B' : 'var(--text3)', whiteSpace: 'nowrap' }}>
                                    {dueOverdue ? 'Overdue' : 'Due'} {new Date(cycle.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                  </span>
                                )}

                                <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                                  <button
                                    className={styles.editBtn}
                                    onClick={() => { switchClient(c.id); navigate('/content', { state: { jumpToFolderPath: cycle.folder_path } }) }}
                                    style={{ whiteSpace: 'nowrap', color: 'var(--gold-light)' }}
                                  >
                                    Open folder <i className="ti ti-arrow-right" aria-hidden="true" />
                                  </button>
                                  <button
                                    className={styles.editBtn}
                                    onClick={() => setBreakerOpenCycle(breakerOpenCycle === cycle.id ? null : cycle.id)}
                                    title="Manual controls — rare, for cases decided outside the portal"
                                    style={breakerOpenCycle === cycle.id ? { color: 'var(--gold-light)' } : undefined}
                                  >
                                    <i className="ti ti-adjustments" aria-hidden="true" /> Manual
                                  </button>
                                </div>
                              </div>

                              {breakerOpenCycle === cycle.id && (
                                <div style={{ borderTop: '0.5px solid var(--border)', marginTop: '12px', paddingTop: '12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                      className="btn"
                                      style={{ fontSize: '12px', color: '#F0997B' }}
                                      onClick={() => clearCycle(cycle, c)}
                                    >
                                      Clear Cycle
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ fontSize: '12px', opacity: 0.5 }}
                                      onClick={() => showToast('Nudge is coming soon')}
                                      title="Coming soon — sends the client a reminder about this cycle"
                                    >
                                      Nudge Client
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {editingClient?.id === c.id && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '16px' }}>
                      <div className={styles.formGrid}>
                        <div className={styles.field}>
                          <label className={styles.label}>Client Name</label>
                          <input className={styles.input} value={editingClient.name} onChange={e => setEditingClient(p => ({...p, name: e.target.value}))} />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Notification Email</label>
                          <input
                            className={styles.input}
                            type="email"
                            value={editingClient.notification_email || ''}
                            onChange={e => setEditingClient(p => ({...p, notification_email: e.target.value}))}
                            placeholder="client@example.com"
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Retainer Start Date</label>
                          <input
                            className={styles.input}
                            type="date"
                            value={editingClient.retainer_start_date || ''}
                            onChange={e => setEditingClient(p => ({...p, retainer_start_date: e.target.value || null}))}
                          />
                          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>Drives mid-month notes (every 14 days) — set this once at signing.</div>
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Service Tier</label>
                          <select
                            className={styles.input}
                            value={editingClient.service_tier || ''}
                            onChange={e => setEditingClient(p => ({...p, service_tier: e.target.value || null}))}
                          >
                            <option value="">Not set</option>
                            <option value="pulse">Pulse</option>
                            <option value="flagship">Flagship / Sprint</option>
                          </select>
                        </div>
                        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                          <label className={styles.label}>Mission Statement</label>
                          <textarea
                            className={styles.input}
                            rows={2}
                            style={{ resize: 'vertical' }}
                            value={editingClient.mission_statement || ''}
                            onChange={e => setEditingClient(p => ({...p, mission_statement: e.target.value}))}
                            placeholder="Pull a real line from their strategy playbook — shows on their Overview banner"
                          />
                        </div>
                        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                          <label className={styles.label}>Brand Pillars</label>
                          <input
                            className={styles.input}
                            value={editingClient.brand_pillars || ''}
                            onChange={e => setEditingClient(p => ({...p, brand_pillars: e.target.value}))}
                            placeholder="Comma-separated, e.g. Authentic, Strategic, Approachable, Consistent"
                          />
                        </div>
                        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                          <label className={styles.label}>Cadence Targets (posts/week, per platform)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
                            {['facebook', 'instagram', 'linkedin', 'youtube', 'tiktok'].map(platform => (
                              <div key={platform}>
                                <label style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'capitalize', display: 'block', marginBottom: '4px' }}>{platform}</label>
                                <input
                                  className={styles.input}
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={editingClient.cadence_targets?.[platform] ?? ''}
                                  onChange={e => {
                                    const val = e.target.value
                                    setEditingClient(p => ({
                                      ...p,
                                      cadence_targets: { ...(p.cadence_targets || {}), [platform]: val === '' ? undefined : Number(val) }
                                    }))
                                  }}
                                  placeholder="0"
                                />
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>Leave blank for platforms this client doesn't use — no card shows for those.</div>
                        </div>
                        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                          <label className={styles.label}>ROI Baselines (captured once at onboarding, restated quarterly)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                            <div>
                              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Time recovered (hrs/mo)</label>
                              <input
                                className={styles.input}
                                type="number" min="0" step="0.5"
                                value={editingClient.time_recovered_hours ?? ''}
                                onChange={e => setEditingClient(p => ({...p, time_recovered_hours: e.target.value === '' ? null : Number(e.target.value)}))}
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Their hourly value ($)</label>
                              <input
                                className={styles.input}
                                type="number" min="0" step="1"
                                value={editingClient.time_recovered_value ?? ''}
                                onChange={e => setEditingClient(p => ({...p, time_recovered_value: e.target.value === '' ? null : Number(e.target.value)}))}
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Cost avoidance ($/mo)</label>
                              <input
                                className={styles.input}
                                type="number" min="0" step="1"
                                value={editingClient.cost_avoidance_amount ?? ''}
                                onChange={e => setEditingClient(p => ({...p, cost_avoidance_amount: e.target.value === '' ? null : Number(e.target.value)}))}
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>What it replaces</label>
                              <input
                                className={styles.input}
                                value={editingClient.cost_avoidance_label || ''}
                                onChange={e => setEditingClient(p => ({...p, cost_avoidance_label: e.target.value}))}
                                placeholder="e.g. content team scaling"
                              />
                            </div>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px', marginBottom: '12px' }}>Leave any field blank to keep it internal — none of these fields alone make anything client-visible.</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', padding: '12px', background: 'var(--surface3)', borderRadius: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--text2)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!!editingClient.roi_show_time_hours}
                                onChange={e => setEditingClient(p => ({...p, roi_show_time_hours: e.target.checked}))}
                              />
                              Show hours saved
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--text2)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!!editingClient.roi_show_time_value}
                                onChange={e => setEditingClient(p => ({...p, roi_show_time_value: e.target.checked}))}
                              />
                              Show dollar value of time
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--text2)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!!editingClient.roi_show_cost_avoidance}
                                onChange={e => setEditingClient(p => ({...p, roi_show_cost_avoidance: e.target.checked}))}
                              />
                              Show cost avoidance
                            </label>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>
                            Each is off by default — nothing shows to this client on Metrics, Overview, or in reports until you turn it on here, even if a number's already entered above.
                          </div>
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Primary Accent</label>
                          <div className={styles.colorRow}>
                            <input type="color" className={styles.colorPicker} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                            <input className={styles.input} value={editingClient.primary_color} onChange={e => setEditingClient(p => ({...p, primary_color: e.target.value}))} />
                          </div>
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Secondary Accent</label>
                          <div className={styles.colorRow}>
                            <input type="color" className={styles.colorPicker} value={editingClient.secondary_color} onChange={e => setEditingClient(p => ({...p, secondary_color: e.target.value}))} />
                            <input className={styles.input} value={editingClient.secondary_color} onChange={e => setEditingClient(p => ({...p, secondary_color: e.target.value}))} />
                          </div>
                        </div>
                      </div>

                      {/* Existing team members for this client */}
                      {teamMembers.filter(m => m.client_id === editingClient.id).length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '4px' }}>
                          <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '10px' }}>Current Portal Access</div>
                          {teamMembers.filter(m => m.client_id === editingClient.id).map(m => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                              <i className="ti ti-user" style={{ fontSize: '14px', color: 'var(--text3)' }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', color: 'var(--text)' }}>{m.email || 'No email on file'}</div>
                              </div>
                              <span style={{ fontSize: '11px', color: 'var(--text3)', marginRight: '4px' }}>
                                {m.role === 'viewer' ? 'Viewer' : 'Approver'}
                              </span>
                              <button
                                className={styles.editBtn}
                                onClick={() => removeTeamMember(m)}
                                title="Remove portal access"
                                style={{ color: 'var(--coral, #e0845a)', fontSize: '12px' }}
                              >
                                <i className="ti ti-trash" /> Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add another team member */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '4px' }}>
                        <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '12px' }}>
                          {teamMembers.filter(m => m.client_id === editingClient.id).length > 0 ? 'Add Another Team Member' : 'Portal Access'}
                        </div>
                        <div className={styles.formGrid}>
                          <div className={styles.field}>
                            <label className={styles.label}>Login Email</label>
                            <input
                              className={styles.input}
                              type="email"
                              value={newMember.email}
                              onChange={e => setNewMember(p => ({...p, email: e.target.value}))}
                              placeholder="teammate@example.com"
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.label}>Temporary Password</label>
                            <input
                              className={styles.input}
                              type="password"
                              value={newMember.password}
                              onChange={e => setNewMember(p => ({...p, password: e.target.value}))}
                              placeholder="Leave blank to auto-generate"
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.label}>Role</label>
                            <select
                              className={styles.input}
                              value={clientPortalRole}
                              onChange={e => setClientPortalRole(e.target.value)}
                            >
                              <option value="member">Approver — can review, approve files, and comment</option>
                              <option value="viewer">Viewer — can view everything and comment, can't approve</option>
                            </select>
                          </div>
                        </div>
                        <button
                          className="btn btn-gold"
                          style={{ fontSize: '12px' }}
                          onClick={async () => {
                            if (!newMember.email) return showToast('Enter an email')
                            setSaving(true)
                            const password = newMember.password || generatePassword()
                            const { data, error } = await supabase.functions.invoke('create-user', {
                              body: { email: newMember.email, password, client_id: editingClient.id, role: clientPortalRole }
                            })
                            if (error) {
                              let message = 'Failed to create user.'
                              try {
                                const body = await error.context?.json()
                                if (body?.error) message = body.error
                              } catch {}
                              showToast(message)
                            } else if (data?.error) {
                              showToast(data.error)
                            } else {
                              await apiFetch('/api/send-email', {
                                method: 'POST',
                                body: JSON.stringify({
                                  type: 'welcome',
                                  clientName: editingClient.name,
                                  recipientEmail: newMember.email
                                })
                              })
                              showToast('Portal access created — welcome email sent!')
                              setNewMember({ email: '', password: '', client_id: '', role: 'member' })
                              setClientPortalRole('member')
                              await loadTeam()
                            }
                            setSaving(false)
                          }}
                          disabled={saving}
                        >
                          <i className="ti ti-user-plus" aria-hidden="true" /> Add Portal Access
                        </button>
                      </div>

                      <div className={styles.formActions}>
                        <button className="btn" onClick={() => setEditingClient(null)}>Cancel</button>
                        <button className="btn btn-gold" onClick={saveClientBranding} disabled={saving}>Save Branding</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Onboard New Client</div>
            <div className={styles.formCard}>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Client Name</label>
                <input className={styles.input} value={newClient.name} onChange={e => setNewClient(p => ({...p, name: e.target.value}))} placeholder="e.g. Acme Brand Co." />
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Primary Accent</label>
                <div className={styles.colorRow}>
                  <input type="color" className={styles.colorPicker} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                  <input className={styles.input} value={newClient.primary_color} onChange={e => setNewClient(p => ({...p, primary_color: e.target.value}))} />
                </div>
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Secondary Accent</label>
                <div className={styles.colorRow}>
                  <input type="color" className={styles.colorPicker} value={newClient.secondary_color} onChange={e => setNewClient(p => ({...p, secondary_color: e.target.value}))} />
                  <input className={styles.input} value={newClient.secondary_color} onChange={e => setNewClient(p => ({...p, secondary_color: e.target.value}))} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: '12px' }}>Portal Access</div>
                <div className={styles.field} style={{ marginBottom: '12px' }}>
                  <label className={styles.label}>Login Email</label>
                  <input
                    className={styles.input}
                    type="email"
                    value={newMember.email}
                    onChange={e => setNewMember(p => ({...p, email: e.target.value}))}
                    placeholder="client@example.com"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Temporary Password</label>
                  <input
                    className={styles.input}
                    type="password"
                    value={newMember.password}
                    onChange={e => setNewMember(p => ({...p, password: e.target.value}))}
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
                <div className={styles.field} style={{ marginTop: '12px' }}>
                  <label className={styles.label}>Role</label>
                  <select
                    className={styles.input}
                    value={clientPortalRole}
                    onChange={e => setClientPortalRole(e.target.value)}
                  >
                    <option value="member">Approver — can review, approve files, and comment</option>
                    <option value="viewer">Viewer — can view everything and comment, can't approve</option>
                  </select>
                </div>
              </div>
              <button
                className="btn btn-gold"
                style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
                onClick={onboardClient}
                disabled={saving || !newClient.name.trim()}
              >
                <i className="ti ti-user-plus" aria-hidden="true" /> Onboard Client
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <div className={styles.sectionLabel}>Activity</div>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 16px' }}>
            {activityLoading && <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text3)' }}>Loading...</div>}
            {!activityLoading && activityFeed.length === 0 && (
              <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text3)' }}>No recent activity</div>
            )}
            {activityFeed.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 0', borderBottom: i < activityFeed.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color, marginTop: '6px', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: 'var(--text1)' }}>{item.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{item.subtitle}</div>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{item.relativeTime}</span>
              </div>
            ))}
          </div>
        </div>
        </>
      )}

      {tab === 'team' && (
        <div className={styles.adminLayout}>
          <div>
            <div className={styles.sectionLabel}>Portal Accounts</div>
            <div className={styles.teamList}>
              {teamMembers.map((m, i) => (
                <div key={i} className={styles.teamRow}>
                  <div className={styles.teamAvatar}>
                    {m.role === 'admin' ? <i className="ti ti-shield" aria-hidden="true" /> : m.role === 'editor' ? <i className="ti ti-pencil" aria-hidden="true" /> : <i className="ti ti-user" aria-hidden="true" />}
                  </div>
                  <div className={styles.teamInfo}>
                    <div className={styles.teamRole}>{m.email || 'No email on file'}</div>
                    <div className={styles.teamClient}>{m.role === 'admin' ? 'Admin' : m.role === 'editor' ? 'Editor' : m.clients?.name || 'Unassigned'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className={styles.teamBadge} style={{
                      background: m.role === 'admin' ? 'var(--gold-bg)' : m.role === 'editor' ? 'rgba(93,202,165,0.14)' : 'var(--teal-bg)',
                      color: m.role === 'admin' ? 'var(--gold-light)' : m.role === 'editor' ? 'var(--teal)' : 'var(--teal)'
                    }}>
                      {m.role}
                    </div>
                    {m.role !== 'admin' && (
                      <button
                        className={styles.editBtn}
                        onClick={() => removeTeamMember(m)}
                        title="Remove portal access"
                        style={{ color: 'var(--coral, #e0845a)', fontSize: '12px' }}
                      >
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {teamMembers.length === 0 && (
                <div className={styles.empty}>No accounts yet</div>
              )}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Add Team Member</div>
            <div className={styles.formCard}>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.input}
                  value={newMember.role === 'member' ? 'editor' : newMember.role}
                  onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="editor">Editor — can manage files, send for review</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
              <div className={styles.field} style={{ marginBottom: '12px' }}>
                <label className={styles.label}>Login Email</label>
                <input
                  className={styles.input}
                  type="email"
                  value={newMember.email}
                  onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))}
                  placeholder="colleague@example.com"
                />
              </div>
              <div className={styles.field} style={{ marginBottom: '16px' }}>
                <label className={styles.label}>Temporary Password</label>
                <input
                  className={styles.input}
                  type="password"
                  value={newMember.password}
                  onChange={e => setNewMember(p => ({ ...p, password: e.target.value }))}
                  placeholder="Leave blank to auto-generate"
                />
              </div>
              <button
                className="btn btn-gold"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={saving || !newMember.email}
                onClick={async () => {
                  if (!newMember.email) return showToast('Enter an email')
                  setSaving(true)
                  const password = newMember.password || generatePassword()
                  const role = newMember.role === 'member' ? 'editor' : newMember.role
                  const { data, error } = await supabase.functions.invoke('create-user', {
                    body: { email: newMember.email, password, role, client_id: null }
                  })
                  if (error) {
                    let message = 'Failed to create user.'
                    try {
                      const body = await error.context?.json()
                      if (body?.error) message = body.error
                    } catch {}
                    showToast(message)
                  } else if (data?.error) {
                    showToast(data.error)
                  } else {
                    await apiFetch('/api/send-email', {
                      method: 'POST',
                      body: JSON.stringify({
                        type: 'welcome',
                        clientName: 'Glowing Moon Media',
                        recipientEmail: newMember.email
                      })
                    })
                    showToast(`${role.charAt(0).toUpperCase() + role.slice(1)} account created — welcome email sent!`)
                    setNewMember({ email: '', password: '', client_id: '', role: 'member' })
                    await loadTeam()
                  }
                  setSaving(false)
                }}
              >
                <i className="ti ti-user-plus" /> Add Team Member
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'revisions' && (
        <div>
          <div className={styles.sectionLabel}>Client Revision Notes</div>
          {loadingComments && <div className={styles.empty}>Loading...</div>}
          {!loadingComments && comments.length === 0 && (
            <div className={styles.empty}>No revision notes yet</div>
          )}
          {Object.entries(commentsByClient).map(([clientName, { color, items }]) => (
            <div key={clientName} style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color || 'var(--gold)' }} />
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{clientName}</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{items.length} note{items.length !== 1 ? 's' : ''}</div>
              </div>
              <div className={styles.teamList}>
                {items.map(c => (
                  <div key={c.id} className={styles.teamRow} style={{ alignItems: 'flex-start', gap: '12px' }}>
                    <div className={styles.teamAvatar} style={{ marginTop: '2px' }}>
                      <i className="ti ti-message" />
                    </div>
                    <div className={styles.teamInfo} style={{ flex: 1 }}>
                      <div className={styles.teamRole} style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>
                        {c.file_path.split('/').pop()}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5' }}>{c.comment}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '6px' }}>
                        {new Date(c.created_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className={styles.editBtn}
                      onClick={() => dismissComment(c)}
                      title="Mark this note resolved — stays visible in the folder's history"
                      style={{ marginTop: '2px', flexShrink: 0 }}
                    >
                      <i className="ti ti-check" /> Mark Resolved
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'reports' && (
        <div>
          <div className={styles.sectionLabel}>Pending Reports</div>
          {loadingReports && <div className={styles.empty}>Loading...</div>}
          {!loadingReports && reportDrafts.length === 0 && (
            <div className={styles.empty}>Nothing pending — drafts show up here as they come due.</div>
          )}
          {reportDrafts.map(draft => (
            <div key={draft.id} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '16px 20px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text1)' }}>{draft.clients?.name}</span>
                <span style={{ fontSize: '12px', background: 'var(--gold-bg)', color: 'var(--gold-light)', padding: '3px 10px', borderRadius: '20px' }}>
                  {draft.report_type === 'mid_month' ? 'Mid-month note' : 'Month in review'}
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
        </div>
      )}

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
              {editingDraft.report_type === 'mid_month' ? 'Mid-month note' : 'Month in review'} — {editingDraft.clients?.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
              Edit freely before sending — this goes out exactly as written below.
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
                disabled={sendingDraft}
                style={{ fontSize: '13px' }}
              >
                {sendingDraft ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'links' && (
        <div>
          <div className={styles.sectionLabel}>New Tracked Link</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px', lineHeight: '1.5' }}>
            Facebook &amp; LinkedIn: paste the link directly in the caption. Instagram captions aren't clickable — use this as the bio link or a Story link sticker instead.
          </div>
          <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Client</label>
              <select
                value={newLink.client_id}
                onChange={e => setNewLink(p => ({ ...p, client_id: e.target.value }))}
                style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '160px' }}
              >
                <option value="">Select client</option>
                {(allClients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Slug</label>
              <input
                value={newLink.slug}
                onChange={e => setNewLink(p => ({ ...p, slug: e.target.value }))}
                placeholder="evohealth-podcast-oct"
                style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '180px' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Destination URL</label>
              <input
                value={newLink.destination_url}
                onChange={e => setNewLink(p => ({ ...p, destination_url: e.target.value }))}
                placeholder="https://evohealthconsulting.com/book"
                style={{ width: '100%', background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Platform</label>
              <select
                value={newLink.platform}
                onChange={e => setNewLink(p => ({ ...p, platform: e.target.value }))}
                style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '130px' }}
              >
                <option value="">Select platform</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="linkedin">LinkedIn</option>
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Label (optional)</label>
              <input
                value={newLink.label}
                onChange={e => setNewLink(p => ({ ...p, label: e.target.value }))}
                placeholder="Podcast episode"
                style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '140px' }}
              />
            </div>
            <button className="btn btn-gold" onClick={createTrackedLink} disabled={savingLink} style={{ fontSize: '13px' }}>
              {savingLink ? 'Creating...' : 'Create Link'}
            </button>
          </div>

          <div className={styles.sectionLabel}>All Links</div>
          {loadingLinks && <div className={styles.empty}>Loading...</div>}
          {!loadingLinks && trackedLinks.length === 0 && (
            <div className={styles.empty}>No tracked links yet — create one above once your short-link domain is attached in Vercel.</div>
          )}
          {trackedLinks.map(link => (
            <div key={link.id} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: '10px', padding: '14px 20px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text1)', fontWeight: '500' }}>
                    {link.clients?.name}{link.platform && ` · ${link.platform}`} — {link.label || link.slug}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                    /go/{link.slug} &rarr; {link.destination_url}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--teal)', fontWeight: '600' }}>{link.clickCount} clicks</span>
                  <i
                    className="ti ti-copy"
                    onClick={() => copyTrackedLink(link)}
                    title="Copy full link"
                    style={{ fontSize: '16px', color: 'var(--text3)', cursor: 'pointer' }}
                  />
                  <i
                    className="ti ti-pencil"
                    onClick={() => editingLink?.id === link.id ? setEditingLink(null) : startEditingLink(link)}
                    title="Edit link"
                    style={{ fontSize: '16px', color: editingLink?.id === link.id ? 'var(--gold-light)' : 'var(--text3)', cursor: 'pointer' }}
                  />
                  <i
                    className="ti ti-trash"
                    onClick={() => deleteTrackedLink(link)}
                    title="Delete link"
                    style={{ fontSize: '16px', color: 'var(--text3)', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {editingLink?.id === link.id && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '0.5px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Slug</label>
                    <input
                      value={editingLink.slug}
                      onChange={e => setEditingLink(p => ({ ...p, slug: e.target.value }))}
                      style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '160px' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Destination URL</label>
                    <input
                      value={editingLink.destination_url}
                      onChange={e => setEditingLink(p => ({ ...p, destination_url: e.target.value }))}
                      style={{ width: '100%', background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Platform</label>
                    <select
                      value={editingLink.platform}
                      onChange={e => setEditingLink(p => ({ ...p, platform: e.target.value }))}
                      style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '130px' }}
                    >
                      <option value="">Select platform</option>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="youtube">YouTube</option>
                      <option value="tiktok">TikTok</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>Label</label>
                    <input
                      value={editingLink.label}
                      onChange={e => setEditingLink(p => ({ ...p, label: e.target.value }))}
                      style={{ background: 'var(--surface3)', border: '0.5px solid var(--border)', color: 'var(--text1)', borderRadius: '7px', padding: '9px 10px', fontSize: '13px', minWidth: '140px' }}
                    />
                  </div>
                  <button onClick={() => setEditingLink(null)} style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text2)', borderRadius: '7px', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button className="btn btn-gold" onClick={saveEditedLink} disabled={savingLinkEdit} style={{ fontSize: '13px' }}>
                    {savingLinkEdit ? 'Saving...' : 'Save'}
                  </button>
                  {editingLink.slug !== editingLink.originalSlug && (
                    <div style={{ fontSize: '11px', color: '#F0997B', width: '100%' }}>
                      Changing the slug breaks the old link if it's already live anywhere — you'll get a confirmation before this saves.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div>
          <div className={styles.sectionLabel}>Recent Activity (last 100 events)</div>
          {loadingLogs && <div className={styles.empty}>Loading audit logs...</div>}
          {!loadingLogs && auditLogs.length === 0 && (
            <div className={styles.empty}>No activity logged yet</div>
          )}
          <div className={styles.teamList}>
            {auditLogs.map((log, i) => (
              <div key={i} className={styles.teamRow}>
                <div className={styles.teamAvatar}>
                  {log.action === 'login' && <i className="ti ti-login" />}
                  {log.action === 'download' && <i className="ti ti-download" />}
                  {log.action === 'delete' && <i className="ti ti-trash" />}
                  {log.action === 'upload' && <i className="ti ti-upload" />}
                  {!['login','download','delete','upload'].includes(log.action) && <i className="ti ti-activity" />}
                </div>
                <div className={styles.teamInfo}>
                  <div className={styles.teamRole}>{log.user_email}</div>
                  <div className={styles.teamClient}>
                    {log.action} · {log.resource}
                    {log.details?.fileName ? ` · ${log.details.fileName}` : ''}
                  </div>
                </div>
                <div className={styles.teamBadge} style={{ background: 'var(--gold-bg)', color: 'var(--gold-light)', fontSize: '12px' }}>
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  )
}
