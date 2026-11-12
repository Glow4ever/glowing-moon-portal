// src/lib/cadence.js (browser copy of api/_cadence.js, keep the two identical)
//
// One weekly rhythm per client, shared by the report job, the team reminder
// job and the Admin screen so they can never disagree about what is due.
//
// Two dates per client, each with one job:
//   delivery_start_date  ("Delivery week 1")  starts the weekly rhythm.
//   retainer_start_date  ("Onboard date")     starts the quarters.
//
// A client with no delivery_start_date is ONBOARDING: the delivery clock is
// off, so no reports are drafted and no delivery reminders go out.
//
// Weeks run Monday to Sunday. The rhythm is a 4-week cycle:
//   standard:     W1 delivery | W2 two-week note | W3 delivery | W4 monthly report
//   operational:  W1 delivery | W2 quiet         | W3 delivery | W4 monthly recap
// Every 12 weeks of the client's own quarter, the quarterly call reminder
// starts at week 9 and clears once the call is marked booked.
//
// Everything else should call weekPlan(client, today) and never work out the
// week itself. src/lib/cadence.js is a copy of this file for the browser.

export const DAY = 24 * 60 * 60 * 1000

export function parseDate(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00Z') }
export function iso(d) { return d.toISOString().slice(0, 10) }
export function addDays(d, n) { return new Date(d.getTime() + n * DAY) }
export function todayUTC() { return parseDate(iso(new Date())) }
export function mondayOnOrBefore(d) { return addDays(d, -((d.getUTCDay() + 6) % 7)) }

// Position within the 4-week cycle, counted from the delivery start.
export function cadenceFor(anchorStr, today) {
  if (!anchorStr) return null
  const start = mondayOnOrBefore(parseDate(anchorStr))
  const days = Math.floor((today - start) / DAY)
  if (days < 0) return null
  const weekIndex = Math.floor(days / 7)
  const cycleIndex = Math.floor(weekIndex / 4)
  const weekStart = addDays(start, weekIndex * 7)
  return {
    start,
    weekIndex,
    weekInCycle: (weekIndex % 4) + 1,
    cycleIndex,
    cycleStart: addDays(start, cycleIndex * 28),
    weekStart,
    weekEnd: addDays(weekStart, 6),
  }
}

// Position within the client's 12-week quarter, counted from the onboard date.
export function quarterFor(anchorStr, today) {
  if (!anchorStr) return null
  const start = mondayOnOrBefore(parseDate(anchorStr))
  const days = Math.floor((today - start) / DAY)
  if (days < 0) return null
  const weekIndex = Math.floor(days / 7)
  const quarterIndex = Math.floor(weekIndex / 12)
  const quarterStart = addDays(start, quarterIndex * 84)
  return {
    quarterIndex,
    quarterNumber: quarterIndex + 1,
    quarterStart,
    quarterEnd: addDays(quarterStart, 83),
    weekInQuarter: (weekIndex % 12) + 1,
  }
}

// The rhythm is anchored on delivery week 1 only. No fallback: a client
// without it is onboarding.
export function anchorFor(client) {
  return client?.delivery_start_date || null
}

// Quarters count from the onboard date. If it is missing, fall back to the
// delivery start so the call reminder still works.
export function quarterAnchorFor(client) {
  return client?.retainer_start_date || client?.delivery_start_date || null
}

// Which cadence template a client follows. Pulse gets its own in Session 6.
export function templateFor(client) {
  return client?.primary_frame === 'operations' ? 'operational' : 'standard'
}

const TEMPLATES = {
  standard: {
    1: { kind: 'delivery', text: 'Send review cycle', short: 'delivery week' },
    2: { kind: 'note', text: 'Two-week note goes out', short: 'two-week note week' },
    3: { kind: 'delivery', text: 'Send review cycle', short: 'delivery week' },
    4: { kind: 'report', text: 'Monthly report goes out', short: 'monthly report week' },
  },
  operational: {
    1: { kind: 'delivery', text: 'Send review cycle', short: 'delivery week' },
    2: null,
    3: { kind: 'delivery', text: 'Send review cycle', short: 'delivery week' },
    4: { kind: 'report', text: 'Monthly recap goes out', short: 'monthly recap week' },
  },
}

// Booked counts for the current quarter only if it was marked after the
// quarter began, so last quarter's booking never silences this quarter.
export function quarterlyCallDue(quarter, bookedAt) {
  if (!quarter || quarter.weekInQuarter < 9) return false
  return !(bookedAt && new Date(bookedAt) >= quarter.quarterStart)
}

// Monday of the next delivery week after the current one.
export function nextDeliveryStart(cad, template) {
  for (let i = 1; i <= 4; i++) {
    const w = ((cad.weekInCycle - 1 + i) % 4) + 1
    if (TEMPLATES[template][w]?.kind === 'delivery') return addDays(cad.weekStart, i * 7)
  }
  return null
}

// What is due for a client this week. Returns:
//   status    'onboarding' (no delivery week 1), 'upcoming' (starts later), 'active'
//   template  'standard' | 'operational'
//   cycle     cycle position (active only)
//   quarter   quarter position (null if no onboard/delivery date yet)
//   items     [{ kind: 'delivery' | 'note' | 'report' | 'call', text }]
//   weekLabel short name of this week, e.g. 'two-week note week'
//   nextDelivery  Date of the next delivery week's Monday (active only)
//   chip      one line for the client card
export function weekPlan(client, today, opts = {}) {
  const template = templateFor(client)
  const anchor = anchorFor(client)
  const quarter = quarterFor(quarterAnchorFor(client), today)
  const base = { template, quarter, items: [], cycle: null, weekLabel: null, nextDelivery: null }

  if (!anchor) {
    return { ...base, status: 'onboarding', chip: 'Onboarding' }
  }
  const cycle = cadenceFor(anchor, today)
  if (!cycle) {
    const startsOn = mondayOnOrBefore(parseDate(anchor))
    return { ...base, status: 'upcoming', startsOn, chip: 'Delivery starts ' + shortDate(startsOn) }
  }

  const slot = TEMPLATES[template][cycle.weekInCycle]
  const items = []
  if (slot) items.push({ kind: slot.kind, text: slot.text })
  if (quarterlyCallDue(quarter, opts.quarterlyCallBookedAt ?? client.quarterly_call_booked_at)) {
    items.push({ kind: 'call', text: 'Book quarterly call (quarter ends ' + shortDate(quarter.quarterEnd) + ')' })
  }
  const weekLabel = slot ? slot.short : 'quiet week'
  const chip = (quarter ? 'Q' + quarter.quarterNumber + ', week ' + quarter.weekInQuarter + ', ' : '') + weekLabel

  return {
    ...base,
    status: 'active',
    cycle,
    items,
    weekLabel,
    nextDelivery: nextDeliveryStart(cycle, template),
    chip,
  }
}

export function shortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
