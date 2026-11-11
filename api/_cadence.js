// api/_cadence.js
//
// One weekly rhythm per client, shared by the report job and the team
// reminder job so they can never disagree about what week it is.
//
// Weeks run Monday to Sunday, counted from the Monday on or before the
// client's report_schedule_start (or retainer_start_date).
//
// Every 4 weeks is one cycle:
//   Week 1: send review cycle
//   Week 2: two-week note (credibility clients only)
//   Week 3: send review cycle
//   Week 4: monthly report (recap for operations clients)
//
// Every 12 weeks (3 cycles) is one quarter. The quarterly call reminder
// starts at the 8-week mark (week 9) so all of the third cycle is left to
// book the call and plan the next quarter.

const DAY = 24 * 60 * 60 * 1000

function parseDate(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00Z') }
function iso(d) { return d.toISOString().slice(0, 10) }
function addDays(d, n) { return new Date(d.getTime() + n * DAY) }
function todayUTC() { return parseDate(iso(new Date())) }
function mondayOnOrBefore(d) { return addDays(d, -((d.getUTCDay() + 6) % 7)) }

function cadenceFor(anchorStr, today) {
  if (!anchorStr) return null
  const start = mondayOnOrBefore(parseDate(anchorStr))
  const days = Math.floor((today - start) / DAY)
  if (days < 0) return null
  const weekIndex = Math.floor(days / 7)
  const cycleIndex = Math.floor(weekIndex / 4)
  const quarterIndex = Math.floor(weekIndex / 12)
  const weekStart = addDays(start, weekIndex * 7)
  const quarterStart = addDays(start, quarterIndex * 84)
  return {
    start,
    weekIndex,
    weekInCycle: (weekIndex % 4) + 1,
    cycleIndex,
    cycleStart: addDays(start, cycleIndex * 28),
    weekStart,
    weekEnd: addDays(weekStart, 6),
    quarterIndex,
    quarterStart,
    quarterEnd: addDays(quarterStart, 83),
    weekInQuarter: (weekIndex % 12) + 1,
  }
}

function anchorFor(client) {
  return client.report_schedule_start || client.retainer_start_date || null
}

// Booked counts for the current quarter only if it was marked after the
// quarter began, so last quarter's booking never silences this quarter.
function quarterlyCallDue(cad, bookedAt) {
  if (!cad || cad.weekInQuarter < 9) return false
  return !(bookedAt && new Date(bookedAt) >= cad.quarterStart)
}

module.exports = { DAY, parseDate, iso, addDays, todayUTC, cadenceFor, anchorFor, quarterlyCallDue }
