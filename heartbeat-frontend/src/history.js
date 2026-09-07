// history.js
// ─────────────────────────────────────────────────────────────────────────────
// The reading-list logic behind the History tab: how a filter set becomes a
// server query, which rows survive the client-side pass, how pages are stitched
// together, and how far the live stream may grow the table.
//
// Pure functions over plain data, extracted from App.jsx so they can be tested
// without a DOM or a React renderer. This is where the paging bugs lived, so
// this is the part that needs to stay covered.
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORY_PAGE = 200 // rows fetched for the history table
export const LOAD_MORE_PAGE = 50 // rows added per "Load older"
// Ceiling on rows held in memory once the user has paged back through history.
export const HISTORY_HARD_CAP = 2000

// Stable identity for a reading, used for React keys and for de-duplicating
// pages that overlap on their boundary timestamp.
export const readingKey = (r) => r.id ?? r.recorded_at

// Oldest recorded_at in a set of readings, or null when there are none. Parsed
// rather than string-compared so mixed ISO offsets still order correctly.
export const oldestTimestamp = (rows = []) => {
  let oldest = null
  let oldestMs = Infinity
  for (const r of rows) {
    const at = Date.parse(r.recorded_at)
    if (!Number.isNaN(at) && at < oldestMs) {
      oldestMs = at
      oldest = r.recorded_at
    }
  }
  return oldest
}

// A yyyy-mm-dd date input covers a whole local day. Derived in one place so the
// server query and the client-side pass can never disagree about where the day
// starts and ends.
export const dayBounds = ({ dateFrom, dateTo } = {}) => ({
  since: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
  until: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
})

// Every filter the server understands, in one object. The table, "Load older"
// and the CSV export all send exactly this, so the export can never contain
// rows the table never showed. Undefined values are dropped by the query
// builder in api.js.
export const historyQuery = (filters = {}) => {
  const { since, until } = dayBounds(filters)
  return {
    type: filters.filterType && filters.filterType !== 'All' ? filters.filterType : undefined,
    abnormal_only: filters.abnormalOnly || undefined,
    min_confidence: filters.minConfidence || undefined,
    since,
    until,
  }
}

// A backwards range is a typo, not a query. Left unchecked the server dutifully
// returns nothing and the table says "no readings match these filters", which
// sends people hunting for missing data that was never missing.
export const dateRangeError = ({ dateFrom, dateTo } = {}) =>
  dateFrom && dateTo && dateFrom > dateTo
    ? 'The "from" date is after the "to" date — no readings can fall in that range.'
    : null

// yyyy-mm-dd for a Date, in local time. toISOString() would shift the day for
// anyone west of UTC, which is exactly the bug this avoids.
export const toDateInput = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Date-input values for the common ranges, so the usual case is one click
// rather than two pickers.
export const PRESET_RANGES = ['Today', 'Last 7 days', 'Last 30 days']

export const presetRange = (name, today = new Date()) => {
  const end = toDateInput(today)
  const back = (days) => {
    const d = new Date(today)
    d.setDate(d.getDate() - days)
    return toDateInput(d)
  }
  switch (name) {
    case 'Today':
      return { dateFrom: end, dateTo: end }
    case 'Last 7 days':
      return { dateFrom: back(6), dateTo: end } // inclusive of today
    case 'Last 30 days':
      return { dateFrom: back(29), dateTo: end }
    default:
      return { dateFrom: '', dateTo: '' }
  }
}

export const hasActiveFilters = (filters = {}) =>
  Boolean(
    (filters.filterType && filters.filterType !== 'All') ||
      filters.abnormalOnly ||
      filters.minConfidence ||
      filters.dateFrom ||
      filters.dateTo,
  )

// The server already applied these filters to what it sent. This second pass
// exists only for beats that arrive live over the socket, which bypass it.
export const filterReadings = (rows = [], filters = {}) => {
  const { since, until } = dayBounds(filters)
  const minC = filters.minConfidence ? parseFloat(filters.minConfidence) : 0
  const sinceMs = since ? Date.parse(since) : null
  const untilMs = until ? Date.parse(until) : null

  return rows.filter((r) => {
    if (filters.filterType && filters.filterType !== 'All' && r.classification !== filters.filterType)
      return false
    if (filters.abnormalOnly && !r.is_abnormal) return false
    if ((r.confidence || 0) < minC) return false
    const at = Date.parse(r.recorded_at)
    if (sinceMs != null && at < sinceMs) return false
    if (untilMs != null && at > untilMs) return false
    return true
  })
}

// Rows from an incoming page that we do not already hold. Paging asks for
// readings older than the oldest row held and `until` is inclusive, so the
// boundary row always comes back again.
export const newRows = (existing = [], incoming = []) => {
  const seen = new Set(existing.map(readingKey))
  return incoming.filter((r) => !seen.has(readingKey(r)))
}

// A page is the last one when it came back short, or added nothing new - the
// latter guards the pathological case where every row shares one timestamp and
// a full page is entirely duplicates.
export const isLastPage = (added = [], rows = [], pageSize = LOAD_MORE_PAGE) =>
  added.length === 0 || rows.length < pageSize

// How many rows the table may hold after one live beat arrives. Live beats must
// not truncate pages the user has already paged in, but must not grow the table
// without bound either.
export const liveHistoryCap = (currentLength = 0) =>
  Math.min(HISTORY_HARD_CAP, Math.max(HISTORY_PAGE, currentLength + 1))

// Fold a live beat into the cached /api/stats figures. Optimistic: the server
// is not re-asked, so these drift until the next load.
export const applyBeatToStats = (prev, beat) => {
  const base = prev || { total_beats: 0, abnormal_beats: 0, counts_by_class: {} }
  const counts = { ...base.counts_by_class }
  counts[beat.classification] = (counts[beat.classification] || 0) + 1
  return {
    total_beats: base.total_beats + 1,
    abnormal_beats: base.abnormal_beats + (beat.is_abnormal ? 1 : 0),
    counts_by_class: counts,
    latest_bpm: beat.bpm,
    latest_classification: beat.classification,
  }
}
