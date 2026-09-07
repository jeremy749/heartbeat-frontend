// Tests for the history-list logic. Run with `npm test`.
//
// These cover the paging and filtering that used to live inside App.jsx, where
// two real bugs hid: an offset-based pager that duplicated and skipped rows as
// new beats arrived, and a table whose filters disagreed with the CSV export.
//
// Dates are built from local-time strings rather than hard-coded UTC, so the
// suite passes in any timezone.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_HARD_CAP,
  HISTORY_PAGE,
  LOAD_MORE_PAGE,
  applyBeatToStats,
  dayBounds,
  filterReadings,
  hasActiveFilters,
  historyQuery,
  isLastPage,
  liveHistoryCap,
  newRows,
  oldestTimestamp,
  readingKey,
} from './history.js'

// A reading recorded at a given local wall-clock time.
const at = (local) => new Date(local).toISOString()

const reading = (overrides = {}) => ({
  id: 1,
  recorded_at: at('2026-01-02T12:00:00'),
  classification: 'Normal',
  confidence: 0.9,
  is_abnormal: false,
  ...overrides,
})

const NO_FILTERS = { filterType: 'All', abnormalOnly: false, minConfidence: '', dateFrom: '', dateTo: '' }

describe('readingKey', () => {
  it('prefers the id', () => {
    assert.equal(readingKey({ id: 42, recorded_at: 'x' }), 42)
  })

  it('falls back to the timestamp when there is no id', () => {
    assert.equal(readingKey({ recorded_at: 'x' }), 'x')
  })

  it('treats id 0 as a real id', () => {
    // `??` not `||` - row zero is a row.
    assert.equal(readingKey({ id: 0, recorded_at: 'x' }), 0)
  })
})

describe('oldestTimestamp', () => {
  it('returns null for an empty list', () => {
    assert.equal(oldestTimestamp([]), null)
  })

  it('finds the oldest regardless of array order', () => {
    const oldest = at('2026-01-01T08:00:00')
    const rows = [
      reading({ recorded_at: at('2026-01-03T08:00:00') }),
      reading({ recorded_at: oldest }),
      reading({ recorded_at: at('2026-01-02T08:00:00') }),
    ]
    assert.equal(oldestTimestamp(rows), oldest)
  })

  it('compares instants, not strings', () => {
    // Same instant, different offsets: a lexicographic compare gets this wrong.
    const rows = [
      { recorded_at: '2026-01-02T00:00:00Z' },
      { recorded_at: '2026-01-01T23:00:00-05:00' }, // = 2026-01-02T04:00Z, newer
    ]
    assert.equal(oldestTimestamp(rows), '2026-01-02T00:00:00Z')
  })

  it('ignores unparseable timestamps', () => {
    const good = at('2026-01-01T08:00:00')
    assert.equal(oldestTimestamp([{ recorded_at: 'not a date' }, { recorded_at: good }]), good)
  })
})

describe('historyQuery', () => {
  it('omits every filter at its default', () => {
    assert.deepEqual(historyQuery(NO_FILTERS), {
      type: undefined,
      abnormal_only: undefined,
      min_confidence: undefined,
      since: undefined,
      until: undefined,
    })
  })

  it('passes set filters through', () => {
    const q = historyQuery({ ...NO_FILTERS, filterType: 'Ventricular', abnormalOnly: true, minConfidence: '0.8' })
    assert.equal(q.type, 'Ventricular')
    assert.equal(q.abnormal_only, true)
    assert.equal(q.min_confidence, '0.8')
  })

  it('turns date inputs into day bounds', () => {
    const q = historyQuery({ ...NO_FILTERS, dateFrom: '2026-01-02', dateTo: '2026-01-03' })
    assert.equal(Date.parse(q.since), new Date('2026-01-02T00:00:00').getTime())
    assert.equal(Date.parse(q.until), new Date('2026-01-03T23:59:59').getTime())
    assert.ok(Date.parse(q.until) > Date.parse(q.since))
  })

  it('derives bounds the same way dayBounds does', () => {
    // The table and the query must agree on where a day starts and ends.
    const filters = { ...NO_FILTERS, dateFrom: '2026-02-10', dateTo: '2026-02-11' }
    const q = historyQuery(filters)
    assert.deepEqual({ since: q.since, until: q.until }, dayBounds(filters))
  })
})

describe('hasActiveFilters', () => {
  it('is false when nothing is set', () => {
    assert.equal(hasActiveFilters(NO_FILTERS), false)
  })

  it('is false for an empty filter object', () => {
    assert.equal(hasActiveFilters({}), false)
  })

  it('is true for each filter on its own', () => {
    const cases = [
      { filterType: 'Ventricular' },
      { abnormalOnly: true },
      { minConfidence: '0.8' },
      { dateFrom: '2026-01-02' },
      { dateTo: '2026-01-02' },
    ]
    for (const c of cases) {
      assert.equal(hasActiveFilters({ ...NO_FILTERS, ...c }), true, JSON.stringify(c))
    }
  })
})

describe('filterReadings', () => {
  it('returns everything when no filter is set', () => {
    const rows = [reading(), reading({ id: 2, classification: 'Ventricular' })]
    assert.equal(filterReadings(rows, NO_FILTERS).length, 2)
  })

  it('filters by classification', () => {
    const rows = [reading(), reading({ id: 2, classification: 'Ventricular' })]
    const kept = filterReadings(rows, { ...NO_FILTERS, filterType: 'Ventricular' })
    assert.deepEqual(kept.map((r) => r.id), [2])
  })

  it('filters to abnormal readings', () => {
    const rows = [reading(), reading({ id: 2, is_abnormal: true })]
    assert.deepEqual(filterReadings(rows, { ...NO_FILTERS, abnormalOnly: true }).map((r) => r.id), [2])
  })

  it('filters by minimum confidence', () => {
    const rows = [reading({ id: 1, confidence: 0.5 }), reading({ id: 2, confidence: 0.85 })]
    assert.deepEqual(filterReadings(rows, { ...NO_FILTERS, minConfidence: '0.8' }).map((r) => r.id), [2])
  })

  it('treats a missing confidence as zero', () => {
    const rows = [reading({ confidence: undefined })]
    assert.equal(filterReadings(rows, { ...NO_FILTERS, minConfidence: '0.6' }).length, 0)
    assert.equal(filterReadings(rows, NO_FILTERS).length, 1)
  })

  it('keeps readings inside the date window and drops those outside', () => {
    const rows = [
      reading({ id: 1, recorded_at: at('2026-01-01T12:00:00') }),
      reading({ id: 2, recorded_at: at('2026-01-02T12:00:00') }),
      reading({ id: 3, recorded_at: at('2026-01-03T12:00:00') }),
    ]
    const kept = filterReadings(rows, { ...NO_FILTERS, dateFrom: '2026-01-02', dateTo: '2026-01-02' })
    assert.deepEqual(kept.map((r) => r.id), [2])
  })

  it('includes readings at the very edges of the day', () => {
    const rows = [
      reading({ id: 1, recorded_at: at('2026-01-02T00:00:00') }),
      reading({ id: 2, recorded_at: at('2026-01-02T23:59:59') }),
    ]
    const kept = filterReadings(rows, { ...NO_FILTERS, dateFrom: '2026-01-02', dateTo: '2026-01-02' })
    assert.deepEqual(kept.map((r) => r.id), [1, 2])
  })

  it('applies every filter together', () => {
    const rows = [
      reading({ id: 1, classification: 'Ventricular', is_abnormal: true, confidence: 0.9 }),
      reading({ id: 2, classification: 'Ventricular', is_abnormal: true, confidence: 0.5 }),
      reading({ id: 3, classification: 'Normal', is_abnormal: false, confidence: 0.95 }),
    ]
    const kept = filterReadings(rows, {
      ...NO_FILTERS,
      filterType: 'Ventricular',
      abnormalOnly: true,
      minConfidence: '0.8',
    })
    assert.deepEqual(kept.map((r) => r.id), [1])
  })
})

describe('newRows', () => {
  it('drops the inclusive boundary row the next page repeats', () => {
    const held = [reading({ id: 1 }), reading({ id: 2 })]
    const page = [reading({ id: 2 }), reading({ id: 3 })]
    assert.deepEqual(newRows(held, page).map((r) => r.id), [3])
  })

  it('de-duplicates by timestamp when rows carry no id', () => {
    const stamp = at('2026-01-02T09:00:00')
    const held = [{ recorded_at: stamp }]
    assert.equal(newRows(held, [{ recorded_at: stamp }]).length, 0)
  })

  it('keeps everything when there is no overlap', () => {
    const held = [reading({ id: 1 })]
    assert.equal(newRows(held, [reading({ id: 2 }), reading({ id: 3 })]).length, 2)
  })

  it('handles empty inputs', () => {
    assert.deepEqual(newRows([], []), [])
    assert.equal(newRows([], [reading()]).length, 1)
  })
})

describe('isLastPage', () => {
  const full = Array.from({ length: LOAD_MORE_PAGE }, (_, i) => reading({ id: i }))

  it('is false for a full page that added new rows', () => {
    assert.equal(isLastPage(full, full), false)
  })

  it('is true for a short page', () => {
    const short = full.slice(0, 3)
    assert.equal(isLastPage(short, short), true)
  })

  it('is true when a full page was entirely duplicates', () => {
    // Guards the pathological case where every row shares one timestamp and
    // paging would otherwise refetch the same tail forever.
    assert.equal(isLastPage([], full), true)
  })
})

describe('liveHistoryCap', () => {
  it('holds a fresh table at one page', () => {
    assert.equal(liveHistoryCap(0), HISTORY_PAGE)
    assert.equal(liveHistoryCap(HISTORY_PAGE - 1), HISTORY_PAGE)
  })

  it('grows rather than truncating pages the user has loaded', () => {
    // The regression: a single live beat used to cut the table back to 200,
    // throwing away everything "Load older" had fetched.
    assert.equal(liveHistoryCap(HISTORY_PAGE), HISTORY_PAGE + 1)
    assert.equal(liveHistoryCap(500), 501)
  })

  it('stops at the hard cap', () => {
    assert.equal(liveHistoryCap(HISTORY_HARD_CAP - 1), HISTORY_HARD_CAP)
    assert.equal(liveHistoryCap(HISTORY_HARD_CAP), HISTORY_HARD_CAP)
    assert.equal(liveHistoryCap(HISTORY_HARD_CAP + 100), HISTORY_HARD_CAP)
  })
})

describe('applyBeatToStats', () => {
  it('starts from zero when there are no stats yet', () => {
    const next = applyBeatToStats(null, reading({ bpm: 70 }))
    assert.equal(next.total_beats, 1)
    assert.equal(next.abnormal_beats, 0)
    assert.deepEqual(next.counts_by_class, { Normal: 1 })
    assert.equal(next.latest_bpm, 70)
    assert.equal(next.latest_classification, 'Normal')
  })

  it('counts an abnormal beat', () => {
    const next = applyBeatToStats(null, reading({ classification: 'Ventricular', is_abnormal: true }))
    assert.equal(next.abnormal_beats, 1)
    assert.deepEqual(next.counts_by_class, { Ventricular: 1 })
  })

  it('accumulates across beats', () => {
    let stats = applyBeatToStats(null, reading())
    stats = applyBeatToStats(stats, reading())
    stats = applyBeatToStats(stats, reading({ classification: 'Fusion', is_abnormal: true }))
    assert.equal(stats.total_beats, 3)
    assert.equal(stats.abnormal_beats, 1)
    assert.deepEqual(stats.counts_by_class, { Normal: 2, Fusion: 1 })
  })

  it('does not mutate the previous stats object', () => {
    const prev = { total_beats: 1, abnormal_beats: 0, counts_by_class: { Normal: 1 } }
    const snapshot = structuredClone(prev)
    applyBeatToStats(prev, reading({ classification: 'Ventricular', is_abnormal: true }))
    assert.deepEqual(prev, snapshot)
  })
})
