// api/delivery.js
//
// Deliveries built from the content bank. One endpoint, POST {action, ...}.
//
//   send     team   create a delivery. Files (delivery clients) or
//                   scheduled posts (publishing clients, kind: 'posts').
//   details  anyone who can see the delivery   post details for the review page
//   approve  member (not viewer) or team        approve some or all items
//   comment  any client person or team          leave a note on an item
//   reopen   team   send an item back for review (revised file)
//   resolve  team   close a delivery by hand
//   cancel   team   delete a delivery that was sent by mistake
//
// Review state lives on review_cycle_items.review_status
// (awaiting | approved | changes_requested). The close rule lives in _delivery.js.
// Writes use the service role, so the permission rules live here.

const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const { iso, todayUTC, mondayOnOrBefore, shortDate } = require('./_cadence')
const { contentKey, settle } = require('./_delivery')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const MAX_ITEMS = 60

const DRAFT_DETAIL_FIELDS = 'id, caption, platform_captions, platforms, publish_date, timezone, status, ig_post_type, fb_post_type, yt_title, metricool_post_ids'

function clean(str, max) {
  if (typeof str !== 'string') return ''
  return str.replace(/[<>]/g, '').trim().slice(0, max || 500)
}

async function rolesFor(userId) {
  const { data } = await supabase.from('user_roles').select('client_id, role').eq('user_id', userId)
  return data || []
}

function isTeam(roles) {
  return roles.some(r => !r.client_id && (r.role === 'admin' || r.role === 'editor'))
}

function memberRole(roles, clientId) {
  const row = roles.find(r => r.client_id === clientId)
  return row ? row.role : null
}

function idsOf(draft) {
  return [...new Set(Object.values(draft.metricool_post_ids || {}).map(String))]
}

// Posts already waiting in an open delivery should not be sent twice.
async function draftsInOpenDeliveries(clientId) {
  const { data } = await supabase
    .from('review_cycle_items')
    .select('schedule_draft_id, review_cycles!inner(resolved_at)')
    .eq('client_id', clientId)
    .not('schedule_draft_id', 'is', null)
    .is('review_cycles.resolved_at', null)
  return new Set((data || []).map(r => r.schedule_draft_id))
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  const body = req.body || {}
  const action = body.action

  try {
    const roles = await rolesFor(user.id)
    const team = isTeam(roles)

    // ---------- send ----------
    if (action === 'send') {
      if (!team) return res.status(403).json({ error: 'Only the team can send a delivery.' })
      const clientId = body.clientId
      if (!clientId) return res.status(400).json({ error: 'Pick a client.' })

      const { data: client } = await supabase.from('clients').select('id, name').eq('id', clientId).maybeSingle()
      if (!client) return res.status(404).json({ error: 'Client not found.' })

      let rows = []
      if (body.kind === 'posts') {
        const ids = Array.isArray(body.draftIds) ? body.draftIds.slice(0, MAX_ITEMS + 1) : []
        if (!ids.length) return res.status(400).json({ error: 'Pick at least one scheduled post.' })
        if (ids.length > MAX_ITEMS) return res.status(400).json({ error: 'A delivery can hold up to ' + MAX_ITEMS + ' posts.' })
        const { data: drafts } = await supabase.from('schedule_drafts').select('*').in('id', ids).eq('client_id', clientId)
        const taken = await draftsInOpenDeliveries(clientId)
        const usable = (drafts || []).filter(d => d.status === 'scheduled' && d.active !== false && !taken.has(d.id))
        if (!usable.length) return res.status(400).json({ error: 'None of those posts can be sent. They must be scheduled and not already in an open delivery.' })
        usable.sort((a, b) => String(a.publish_date || '').localeCompare(String(b.publish_date || '')))
        rows = usable.map((d, i) => ({
          dropbox_path: d.dropbox_path,
          filename: d.filename || d.dropbox_path.split('/').pop(),
          schedule_draft_id: d.id,
          position: i,
          content_key: contentKey(d),
          metricool_ids: idsOf(d)
        }))
      } else {
        const files = Array.isArray(body.files) ? body.files.slice(0, MAX_ITEMS + 1) : []
        if (!files.length) return res.status(400).json({ error: 'Pick at least one file.' })
        if (files.length > MAX_ITEMS) return res.status(400).json({ error: 'A delivery can hold up to ' + MAX_ITEMS + ' files.' })
        rows = files
          .map((f, i) => ({ dropbox_path: clean(f.path, 1000), filename: clean(f.name, 300), position: i }))
          .filter(f => f.dropbox_path)
          .map(f => ({ ...f, filename: f.filename || f.dropbox_path.split('/').pop() }))
        if (!rows.length) return res.status(400).json({ error: 'Pick at least one file.' })
      }

      const monday = mondayOnOrBefore(todayUTC())
      const label = clean(body.name, 80) || ((body.kind === 'posts' ? 'Posts, ' : 'Delivery, ') + shortDate(monday))
      const due = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : null
      const note = clean(body.note, 1000)

      const { data: cycle, error: cycleErr } = await supabase.from('review_cycles').insert({
        client_id: clientId,
        folder_path: null,
        folder_label: label,
        source: 'bank',
        stage: 'in_review',
        sent_at: new Date().toISOString(),
        due_date: due,
        planned_count: rows.length,
        cycle_week_start: iso(monday),
        sent_by: user.id
      }).select().single()

      if (cycleErr) {
        console.error('delivery send error:', cycleErr)
        const msg = /limit|active|maximum|5/i.test(cycleErr.message || '')
          ? 'This client already has the maximum number of open deliveries. Close one first.'
          : 'Could not create the delivery.'
        return res.status(400).json({ error: msg })
      }

      const { error: itemErr } = await supabase.from('review_cycle_items').insert(
        rows.map(r => ({ ...r, cycle_id: cycle.id, client_id: clientId, review_status: 'awaiting' }))
      )
      if (itemErr) {
        await supabase.from('review_cycles').delete().eq('id', cycle.id)
        console.error('delivery items error:', itemErr)
        return res.status(500).json({ error: 'Could not add the items to the delivery.' })
      }

      if (note) {
        await supabase.from('file_comments').insert({
          client_id: clientId,
          cycle_id: cycle.id,
          folder_path: null,
          file_path: rows[0].dropbox_path,
          comment: note,
          sender_role: 'admin',
          read: false
        })
      }

      return res.status(200).json({ ok: true, cycleId: cycle.id, label, count: rows.length, clientName: client.name, kind: body.kind === 'posts' ? 'posts' : 'files' })
    }

    // Everything below acts on an existing delivery.
    const { data: cycle } = await supabase.from('review_cycles').select('*').eq('id', body.cycleId).maybeSingle()
    if (!cycle || cycle.source !== 'bank') return res.status(404).json({ error: 'Delivery not found.' })

    const mRole = memberRole(roles, cycle.client_id)
    if (!team && !mRole) return res.status(403).json({ error: 'Not allowed.' })
    // viewers can look and comment, but not approve
    const canApprove = team || mRole !== 'viewer'

    // ---------- details ----------
    if (action === 'details') {
      const { data: items } = await supabase
        .from('review_cycle_items').select('id, schedule_draft_id').eq('cycle_id', cycle.id)
      const ids = (items || []).map(i => i.schedule_draft_id).filter(Boolean)
      const posts = {}
      if (ids.length) {
        const { data } = await supabase.from('schedule_drafts').select(DRAFT_DETAIL_FIELDS).in('id', ids)
        ;(data || []).forEach(d => {
          const { metricool_post_ids, ...rest } = d
          posts[d.id] = rest
        })
      }
      return res.status(200).json({ ok: true, posts })
    }

    // ---------- approve ----------
    if (action === 'approve') {
      if (!canApprove) return res.status(403).json({ error: 'Your role can view this delivery but not approve it.' })
      const { data: items } = await supabase.from('review_cycle_items').select('id, review_status').eq('cycle_id', cycle.id)
      let targets = (items || []).filter(i => i.review_status !== 'approved')
      if (Array.isArray(body.itemIds) && body.itemIds.length) {
        const ids = new Set(body.itemIds)
        targets = targets.filter(i => ids.has(i.id))
      }
      if (!targets.length) return res.status(400).json({ error: 'Nothing to approve.' })

      const targetIds = targets.map(i => i.id)
      const { error } = await supabase.from('review_cycle_items')
        .update({ review_status: 'approved', reviewed_at: new Date().toISOString() })
        .in('id', targetIds)
      if (error) {
        console.error('delivery approve error:', error)
        return res.status(500).json({ error: 'Could not save the approval.' })
      }
      // Approving an item settles any open client note on it.
      await supabase.from('file_comments').update({ resolved: true })
        .eq('cycle_id', cycle.id).eq('sender_role', 'member').in('item_id', targetIds)
      const result = await settle(supabase, cycle)
      return res.status(200).json({ ok: true, ...result })
    }

    // ---------- comment ----------
    if (action === 'comment') {
      const text = clean(body.comment, 2000)
      if (!text) return res.status(400).json({ error: 'Write a comment first.' })
      const { data: item } = await supabase
        .from('review_cycle_items').select('id, dropbox_path, schedule_draft_id').eq('id', body.itemId).eq('cycle_id', cycle.id).maybeSingle()
      if (!item) return res.status(404).json({ error: 'Item not found in this delivery.' })

      const sender = team ? 'admin' : 'member'
      const { error } = await supabase.from('file_comments').insert({
        client_id: cycle.client_id,
        cycle_id: cycle.id,
        item_id: item.id,
        folder_path: null,
        file_path: item.dropbox_path,
        comment: text,
        sender_role: sender,
        read: false
      })
      if (error) {
        console.error('delivery comment error:', error)
        return res.status(500).json({ error: 'Could not save the comment.' })
      }

      let published = false
      if (sender === 'member') {
        if (item.schedule_draft_id) {
          const { data: d } = await supabase.from('schedule_drafts').select('status').eq('id', item.schedule_draft_id).maybeSingle()
          published = !!d && d.status === 'published'
        }
        // A client note means the item is not approved. A note on a post that
        // already went out is only logged for the team; nothing changes.
        if (!published) {
          await supabase.from('review_cycle_items')
            .update({ review_status: 'changes_requested', reviewed_at: new Date().toISOString() })
            .eq('id', item.id)
        }
      }
      const result = await settle(supabase, cycle)
      return res.status(200).json({ ok: true, published, ...result })
    }

    // ---------- team only ----------
    if (!team) return res.status(403).json({ error: 'Only the team can do that.' })

    if (action === 'reopen') {
      const { data: item } = await supabase
        .from('review_cycle_items').select('id').eq('id', body.itemId).eq('cycle_id', cycle.id).maybeSingle()
      if (!item) return res.status(404).json({ error: 'Item not found in this delivery.' })
      await supabase.from('review_cycle_items').update({ review_status: 'awaiting', reviewed_at: null }).eq('id', item.id)
      // Notes on the old version are handled; the revised file starts clean.
      await supabase.from('file_comments').update({ resolved: true })
        .eq('cycle_id', cycle.id).eq('item_id', item.id).eq('sender_role', 'member')
      const result = await settle(supabase, cycle, { reopen: true })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'resolve') {
      await supabase.from('review_cycles').update({ stage: 'approved', resolved_at: new Date().toISOString() }).eq('id', cycle.id)
      return res.status(200).json({ ok: true })
    }

    if (action === 'cancel') {
      await supabase.from('file_status').delete().eq('cycle_id', cycle.id)
      await supabase.from('file_comments').delete().eq('cycle_id', cycle.id)
      await supabase.from('review_cycles').delete().eq('id', cycle.id)
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (err) {
    console.error('delivery error:', err)
    return res.status(500).json({ error: 'Something went wrong.' })
  }
}
