// api/_banks.js
//
// One content bank per client per quarter (Session 5a).
//   client_banks                       history: which folder was the bank in which quarter
//   clients.schedule_bank_folder_path  the current bank (what the Content Bank opens)
// The quarter always comes from weekPlan in _cadence.js.

const { weekPlan, iso, todayUTC } = require('./_cadence')

function currentQuarter(client, today) {
  const plan = weekPlan(client, today || todayUTC())
  return plan.quarter || null
}

// Make sure the current bank is recorded. A bank set before this table
// existed is recorded once, against the quarter it is in now.
async function ensureBanks(supabase, client, today) {
  const q = currentQuarter(client, today)
  const { data: rows } = await supabase
    .from('client_banks').select('*').eq('client_id', client.id).order('quarter_number', { ascending: false })
  let banks = rows || []
  if (q && !banks.length && client.schedule_bank_folder_path) {
    const row = {
      client_id: client.id,
      quarter_number: q.quarterNumber,
      quarter_start: iso(q.quarterStart),
      folder_path: client.schedule_bank_folder_path,
      folder_name: client.schedule_bank_folder_name || null
    }
    const { data } = await supabase.from('client_banks').upsert(row, { onConflict: 'client_id,quarter_number' }).select()
    banks = data || [row]
  }
  const currentRow = q ? banks.find(b => b.quarter_number === q.quarterNumber) : null
  return {
    quarter: q ? { number: q.quarterNumber, start: iso(q.quarterStart), end: iso(q.quarterEnd) } : null,
    banks,
    // True when the client is in a quarter that has no bank yet.
    needsBank: !!q && !currentRow
  }
}

async function setBank(supabase, client, folder, userId, today) {
  const q = currentQuarter(client, today)
  await supabase.from('clients')
    .update({ schedule_bank_folder_path: folder.path, schedule_bank_folder_name: folder.name })
    .eq('id', client.id)
  if (q) {
    await supabase.from('client_banks').upsert({
      client_id: client.id,
      quarter_number: q.quarterNumber,
      quarter_start: iso(q.quarterStart),
      folder_path: folder.path,
      folder_name: folder.name,
      set_at: new Date().toISOString(),
      set_by: userId || null
    }, { onConflict: 'client_id,quarter_number' })
  }
}

module.exports = { currentQuarter, ensureBanks, setBank }
