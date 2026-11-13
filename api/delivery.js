// api/delivery.js
//
// Deliveries built from the content bank. One endpoint, POST {action, ...}.
//
//   send     team   create a delivery from picked files and mark it sent
//   approve  member (not viewer) or team   approve some or all items
//   comment  any client person or team      leave a note on an item
//   reopen   team   send an approved item back to review (revised file)
//   resolve  team   close a delivery by hand
//   cancel   team   delete a delivery that was sent by mistake
//
// Writes use the service role, so the rules live here:
//   - team = a user_roles row with client_id null and role admin or editor
//   - a client person must belong to the delivery's client, and viewers are read only
//   - a delivery closes itself the moment every item is approved
// Reads happen in the browser through RLS (see migration 026).

const { requireAuth } = require('./_auth')
const { createClient } = require('@supabase/supabase-js')
const { iso, todayUTC, mondayOnOrBefore, shortDate } = require('./_cadence')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const MAX_ITEMS = 60

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

async function loadCycle(cycleId) {
  const { data } = await supabase.from('review_cycles').select('*').eq('id', cycleId).maybeSingle()
  return data
}

// Close the delivery if every item has an approved status in this cycle.
// Otherwise make sure the stage reads as still open.
async function settle(cycle) {
  const { data: items } = await supabase.from('review_cycle_items').select('id, dropbox_path').eq('cycle_id', cycle.id)
  const { data: statuses } = await supabase
    .from('file_status').select('file_path, status').eq('cycle_id', cycle.id).eq('client_id', cycle.client_id)
  const approved = new Set((statuses || []).filter(s => s.status === 'approved').map(s => s.file_path))
  const total = (items || []).length
  const done = (items || []).filter(i => approved.has(i.dropbox_path)).length
  const allDone = total > 0 && done === total

  if (allDone) {
    const closing = !cycle.resolved_at
    await supabase.from('review_cycles').update({ stage: 'approved', resolved_at: cycle.resolved_at || new Date().toISOString() }).eq('id', cycle.id)
    return { total, approved: done, closed: closing }
  }

  const { data: open } = await supabase
    .from('file_comments').select('id').eq('cycle_id', cycle.id).eq('sender_role', 'member').eq('resolved', false).limit(1)
  const stage = open && open.length ? 'revisions' : 'in_review'
  await supabase.from('review_cycles').update({ stage, resolved_at: null }).eq('id', cycle.id)
  return { total, approved: done, closed: false }
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
      const files = Array.isArray(body.files) ? body.files.slice(0, MAX_ITEMS + 1) : []
      if (!clientId || !files.length) return res.status(400).json({ error: 'Pick at least one file.' })
      if (files.length > MAX_ITEMS) return res.status(400).json({ error: 'A delivery can hold up to ' + MAX_ITEMS + ' files.' })

      const { data: client } = await supabase.from('clients').select('id, name').eq('id', clientId).maybeSingle()
      if (!client) return res.status(404).json({ error: 'Client not found.' })

      const monday = mondayOnOrBefore(todayUTC())
      const weekStart = iso(monday)
      const label = clean(body.name, 80) || ('Delivery, ' + shortDate(monday))
      const due = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : null
      const note = clean(body.note, 1000)

      const cleanFiles = files
        .map((f, i) => ({ path: clean(f.path, 1000), name: clean(f.name, 300), position: i, draft: f.scheduleDraftId || null }))
        .filter(f => f.path)
      if (!cleanFiles.length) return res.status(400).json({ error: 'Pick at least one file.' })

      const { data: cycle, error: cycleErr } = await supabase.from('review_cycles').insert({
        client_id: clientId,
        folder_path: null,
        folder_label: label,
        source: 'bank',
        stage: 'in_review',
        sent_at: new Date().toISOString(),
        due_date: due,
        planned_count: cleanFiles.length,
        cycle_week_start: weekStart,
        sent_by: user.id
      }).select().single()

      if (cycleErr) {
        const msg = /5|limit|active/i.test(cycleErr.message || '')
          ? 'This client already has the maximum number of open deliveries. Close one first.'
          : 'Could not create the delivery.'
        console.error('delivery send error:', cycleErr)
        return res.status(400).json({ error: msg })
      }

      const { error: itemErr } = await supabase.from('review_cycle_items').insert(
        cleanFiles.map(f => ({
          cycle_id: cycle.id,
          client_id: clientId,
          dropbox_path: f.path,
          filename: f.name || f.path.split('/').pop(),
          schedule_draft_id: f.draft,
          position: f.position
        }))
      )
      if (itemErr) {
        await supabase.from('review_cycles').delete().eq('id', cycle.id)
        console.error('delivery items error:', itemErr)
        return res.status(500).json({ error: 'Could not add the files to the delivery.' })
      }

      // A file sent again starts fresh, so clear any old approval for it.
      await supabase.from('file_status').delete().eq('client_id', clientId).in('file_path', cleanFiles.map(f => f.path))

      if (note) {
        await supabase.from('file_comments').insert({
          client_id: clientId,
          cycle_id: cycle.id,
          folder_path: null,
          file_path: cleanFiles[0].path,
          comment: note,
          sender_role: 'admin',
          read: false
        })
      }

      return res.status(200).json({ ok: true, cycleId: cycle.id, label, count: cleanFiles.length, clientName: client.name })
    }

    // Everything below acts on an existing delivery.
    const cycle = await loadCycle(body.cycleId)
    if (!cycle || cycle.source !== 'bank') return res.status(404).json({ error: 'Delivery not found.' })

    const mRole = memberRole(roles, cycle.client_id)
    if (!team && !mRole) return res.status(403).json({ error: 'Not allowed.' })
    // viewers can look and comment, but not approve
    const canApprove = team || mRole !== 'viewer'

    // ---------- approve ----------
    if (action === 'approve') {
      if (!canApprove) return res.status(403).json({ error: 'Your role can view this delivery but not approve it.' })
      const { data: items } = await supabase.from('review_cycle_items').select('id, dropbox_path').eq('cycle_id', cycle.id)
      let targets = items || []
      if (Array.isArray(body.itemIds) && body.itemIds.length) {
        const ids = new Set(body.itemIds)
        targets = targets.filter(i => ids.has(i.id))
      }
      if (!targets.length) return res.status(400).json({ error: 'Nothing to approve.' })

      const now = new Date().toISOString()
      const { error } = await supabase.from('file_status').upsert(
        targets.map(i => ({
          client_id: cycle.client_id,
          cycle_id: cycle.id,
          item_id: i.id,
          file_path: i.dropbox_path,
          status: 'approved',
          updated_at: now
        })),
        { onConflict: 'client_id,file_path' }
      )
      if (error) {
        console.error('delivery approve error:', error)
        return res.status(500).json({ error: 'Could not save the approval.' })
      }
      // Approving a file settles any open client note on it.
      await supabase.from('file_comments').update({ resolved: true })
        .eq('cycle_id', cycle.id).eq('sender_role', 'member').in('item_id', targets.map(i => i.id))
      const result = await settle(cycle)
      return res.status(200).json({ ok: true, ...result })
    }

    // ---------- comment ----------
    if (action === 'comment') {
      const text = clean(body.comment, 2000)
      if (!text) return res.status(400).json({ error: 'Write a comment first.' })
      const { data: item } = await supabase
        .from('review_cycle_items').select('id, dropbox_path').eq('id', body.itemId).eq('cycle_id', cycle.id).maybeSingle()
      if (!item) return res.status(404).json({ error: 'File not found in this delivery.' })

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
      if (sender === 'member') {
        // A client note on an item means that item is not approved.
        await supabase.from('file_status').delete()
          .eq('client_id', cycle.client_id).eq('file_path', item.dropbox_path).eq('cycle_id', cycle.id)
      }
      const result = await settle(cycle)
      return res.status(200).json({ ok: true, ...result })
    }

    // ---------- team only ----------
    if (!team) return res.status(403).json({ error: 'Only the team can do that.' })

    if (action === 'reopen') {
      const { data: item } = await supabase
        .from('review_cycle_items').select('id, dropbox_path').eq('id', body.itemId).eq('cycle_id', cycle.id).maybeSingle()
      if (!item) return res.status(404).json({ error: 'File not found in this delivery.' })
      await supabase.from('file_status').delete()
        .eq('client_id', cycle.client_id).eq('file_path', item.dropbox_path).eq('cycle_id', cycle.id)
      // Notes on the old version are handled; the revised file starts clean.
      await supabase.from('file_comments').update({ resolved: true })
        .eq('cycle_id', cycle.id).eq('item_id', item.id).eq('sender_role', 'member')
      const result = await settle(cycle)
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'resolve') {
      await supabase.from('review_cycles').update({ stage: 'approved', resolved_at: new Date().toISOString() }).eq('id', cycle.id)
      return res.status(200).json({ ok: true })
    }

    if (action === 'cancel') {
      const { data: items } = await supabase.from('review_cycle_items').select('dropbox_path').eq('cycle_id', cycle.id)
      await supabase.from('file_status').delete()
        .eq('cycle_id', cycle.id).in('file_path', (items || []).map(i => i.dropbox_path))
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
