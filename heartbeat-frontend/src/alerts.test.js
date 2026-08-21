// Tests for the alert engine. Run with `npm test`.
//
// Uses node:test / node:assert rather than a test framework so the suite has no
// dependencies and runs on a bare Node 18+ checkout.
//
// Note on the `recent` argument: in the app the newest beat is also `recent[0]`,
// so the current beat counts itself in the window. The fixtures below mirror
// that rather than pretending the window excludes it.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ALERT_RANK, ALERT_THRESHOLDS, evaluateAlert } from './alerts.js'

const beat = (overrides = {}) => ({
  classification: 'Normal',
  confidence: 0.95,
  is_abnormal: false,
  recorded_at: '2026-08-18T20:00:00Z',
  ...overrides,
})

const normal = (o) => beat(o)
const ventricular = (o) => beat({ classification: 'Ventricular', is_abnormal: true, ...o })
const supraventricular = (o) =>
  beat({ classification: 'Supraventricular', is_abnormal: true, ...o })
const fusion = (o) => beat({ classification: 'Fusion', is_abnormal: true, ...o })

const repeat = (n, make) => Array.from({ length: n }, () => make())

describe('evaluateAlert · no data', () => {
  it('reports "none" when there is no beat at all', () => {
    const result = evaluateAlert(null)
    assert.equal(result.level, 'none')
    assert.equal(result.label, 'No data')
  })

  it('tolerates a missing recent array', () => {
    assert.equal(evaluateAlert(normal()).level, 'green')
  })
})

describe('evaluateAlert · uncertainty takes precedence', () => {
  it('flags an unclassified beat as uncertain even at high confidence', () => {
    const b = beat({ classification: 'Unclassified', confidence: 0.99 })
    assert.equal(evaluateAlert(b, [b]).level, 'uncertain')
  })

  it('flags a low-confidence beat as uncertain', () => {
    const b = normal({ confidence: 0.4 })
    assert.equal(evaluateAlert(b, [b]).level, 'uncertain')
  })

  it('does not escalate a low-confidence ventricular beat to red', () => {
    // The model is not sure it saw a ventricular beat, so the honest answer is
    // "uncertain" - claiming "urgent" here would be a guess dressed as a finding.
    const b = ventricular({ confidence: 0.5 })
    assert.equal(evaluateAlert(b, [b]).level, 'uncertain')
  })

  it('treats a missing confidence as zero, not as certainty', () => {
    const b = { classification: 'Normal' }
    assert.equal(evaluateAlert(b, [b]).level, 'uncertain')
  })

  it('is not uncertain exactly at the confidence threshold', () => {
    const b = normal({ confidence: ALERT_THRESHOLDS.minConfidence })
    assert.equal(evaluateAlert(b, [b]).level, 'green')
  })
})

describe('evaluateAlert · red', () => {
  it('escalates a confident ventricular beat', () => {
    const b = ventricular({ confidence: 0.9 })
    const result = evaluateAlert(b, [b])
    assert.equal(result.level, 'red')
    assert.match(result.detail, /ventricular/i)
  })

  it('escalates exactly at the ventricular confidence threshold', () => {
    const b = ventricular({ confidence: ALERT_THRESHOLDS.vConfidenceRed })
    assert.equal(evaluateAlert(b, [b]).level, 'red')
  })

  it('escalates a run of ventricular beats even below that confidence', () => {
    const b = ventricular({ confidence: 0.65 })
    const window = [b, ventricular({ confidence: 0.65 }), ventricular({ confidence: 0.65 })]
    const result = evaluateAlert(b, window)
    assert.equal(result.level, 'red')
    assert.match(result.detail, /run/i)
  })

  it('escalates an abnormal beat that arrives with a rate flag', () => {
    for (const flag of ['TACHY', 'BRADY']) {
      const b = supraventricular({ confidence: 0.9, flags: [flag] })
      assert.equal(evaluateAlert(b, [b]).level, 'red', `${flag} should escalate`)
    }
  })
})

describe('evaluateAlert · amber', () => {
  it('cautions on a confident supraventricular beat in a quiet window', () => {
    const b = supraventricular({ confidence: 0.9 })
    assert.equal(evaluateAlert(b, [b]).level, 'amber')
  })

  it('cautions on a fusion beat', () => {
    const b = fusion({ confidence: 0.9 })
    assert.equal(evaluateAlert(b, [b]).level, 'amber')
  })

  it('cautions on a ventricular beat below the red confidence threshold', () => {
    const b = ventricular({ confidence: 0.65 })
    assert.equal(evaluateAlert(b, [b]).level, 'amber')
  })

  it('cautions when recent abnormal beats sit behind a normal one', () => {
    const b = normal()
    const window = [b, ventricular(), supraventricular()]
    const result = evaluateAlert(b, window)
    assert.equal(result.level, 'amber')
    assert.match(result.detail, /recent abnormal/i)
  })

  it('cautions on an irregular rhythm flag', () => {
    const b = normal({ flags: ['IRREG'] })
    assert.equal(evaluateAlert(b, [b]).level, 'amber')
  })
})

describe('evaluateAlert · green', () => {
  it('reports normal for a confident normal beat in a clean window', () => {
    const b = normal()
    assert.equal(evaluateAlert(b, [b, ...repeat(9, normal)]).level, 'green')
  })

  it('ignores a single abnormal beat behind a normal one', () => {
    const b = normal()
    assert.equal(evaluateAlert(b, [b, ventricular()]).level, 'green')
  })
})

describe('evaluateAlert · a confident normal beat is never urgent', () => {
  // The invariant the module comments call out: history escalates caution, but
  // it must never make the beat in front of you read as "Urgent - review now".
  it('stays amber even after a long ventricular run', () => {
    const b = normal({ confidence: 0.99 })
    const result = evaluateAlert(b, [b, ...repeat(9, ventricular)])
    assert.equal(result.level, 'amber')
    assert.notEqual(result.level, 'red')
  })

  it('stays amber even with a rate flag on the normal beat', () => {
    const b = normal({ confidence: 0.99, flags: ['TACHY'] })
    const result = evaluateAlert(b, [b, ...repeat(9, ventricular)])
    assert.equal(result.level, 'amber')
  })
})

describe('evaluateAlert · what the engine keys off', () => {
  it('classifies on `classification`, not on the is_abnormal flag', () => {
    // The table renders is_abnormal; the engine deliberately does not trust it,
    // so a mislabelled flag cannot manufacture an alert.
    const b = normal({ is_abnormal: true })
    assert.equal(evaluateAlert(b, [b]).level, 'green')
  })

  it('does not escalate a classification it does not recognise', () => {
    const b = beat({ classification: 'Paced', confidence: 0.95 })
    assert.equal(evaluateAlert(b, [b]).level, 'green')
  })

  it('ignores rate flags on a beat it is not confident about', () => {
    // Uncertainty is checked first: an unreliable class must not be escalated
    // to "urgent" just because a flag rode along with it.
    const b = ventricular({ confidence: 0.3, flags: ['TACHY'] })
    assert.equal(evaluateAlert(b, [b]).level, 'uncertain')
  })

  it('works with no history at all', () => {
    assert.equal(evaluateAlert(ventricular({ confidence: 0.9 }), []).level, 'red')
    assert.equal(evaluateAlert(supraventricular({ confidence: 0.9 }), []).level, 'amber')
  })
})

describe('evaluateAlert · window bounds', () => {
  it('ignores abnormal beats that have fallen out of the window', () => {
    const b = normal()
    // Ten normals fill the window; the ventricular beats sit behind them.
    const window = [b, ...repeat(9, normal), ...repeat(5, ventricular)]
    assert.equal(evaluateAlert(b, window).level, 'green')
  })

  it('counts a ventricular run only inside the window', () => {
    const b = ventricular({ confidence: 0.65 })
    const window = [b, ...repeat(9, normal), ...repeat(5, ventricular)]
    // Only the current beat is ventricular within the window, so no run.
    assert.equal(evaluateAlert(b, window).level, 'amber')
  })

  it('honours a caller-supplied window size', () => {
    const b = normal()
    const window = [b, ventricular(), ventricular()]
    const narrow = { ...ALERT_THRESHOLDS, window: 1 }
    assert.equal(evaluateAlert(b, window, narrow).level, 'green')
    assert.equal(evaluateAlert(b, window).level, 'amber')
  })

  it('honours caller-supplied thresholds', () => {
    const b = ventricular({ confidence: 0.75 })
    const strict = { ...ALERT_THRESHOLDS, vConfidenceRed: 0.9 }
    assert.equal(evaluateAlert(b, [b]).level, 'red')
    assert.equal(evaluateAlert(b, [b], strict).level, 'amber')
  })
})

describe('evaluateAlert · shape of the result', () => {
  it('always returns a level, label and detail', () => {
    const cases = [
      null,
      normal(),
      ventricular({ confidence: 0.9 }),
      supraventricular({ confidence: 0.9 }),
      beat({ classification: 'Unclassified' }),
    ]
    for (const c of cases) {
      const result = evaluateAlert(c, c ? [c] : [])
      assert.ok(result.level in ALERT_RANK, `unknown level ${result.level}`)
      assert.equal(typeof result.label, 'string')
      assert.equal(typeof result.detail, 'string')
      assert.ok(result.label.length > 0)
    }
  })
})

describe('ALERT_RANK', () => {
  it('orders severity from red down to none', () => {
    assert.ok(ALERT_RANK.red > ALERT_RANK.amber)
    assert.ok(ALERT_RANK.amber > ALERT_RANK.uncertain)
    assert.ok(ALERT_RANK.uncertain > ALERT_RANK.green)
    assert.ok(ALERT_RANK.green > ALERT_RANK.none)
  })
})
