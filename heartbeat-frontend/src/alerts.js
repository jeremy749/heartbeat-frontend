// alerts.js
// ─────────────────────────────────────────────────────────────────────────────
// Turns a beat (model class + confidence + device flags) plus the recent beat
// history into a single alert level the dashboard can show.
//
// This is intentionally pure (no React) so it can be unit-tested on its own and
// reused by the backend later if you want the server to own the criteria.
//
// Levels, most to least severe:
//   red       — urgent, review now
//   amber      — caution, keep watching
//   green      — normal
//   uncertain  — low-confidence / unclassified; explicitly NOT a diagnosis
//   none       — no data yet
// ─────────────────────────────────────────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  window: 10,                    // how many recent beats to consider
  minConfidence: 0.6,           // below this, a reading is "uncertain"
  vConfidenceRed: 0.7,          // a single confident Ventricular beat -> red
  vCountRedInWindow: 3,         // this many V beats in the window -> red
  abnormalConfidenceAmber: 0.6, // a confident abnormal beat -> at least amber
  abnormalCountAmberInWindow: 2,// this many abnormal beats in the window -> amber
}

const ABNORMAL_CLASSES = new Set(['Ventricular', 'Supraventricular', 'Fusion'])

export function evaluateAlert(latest, recent = [], thresholds = ALERT_THRESHOLDS) {
  if (!latest) {
    return { level: 'none', label: 'No data', detail: 'Waiting for the first beat.' }
  }

  const t = thresholds
  const cls = latest.classification
  const conf = latest.confidence || 0
  const flags = latest.flags || []
  const window = recent.slice(0, t.window)
  const vCount = window.filter((b) => b.classification === 'Ventricular').length
  const abnormalCount = window.filter((b) => ABNORMAL_CLASSES.has(b.classification)).length
  const isAbnormal = ABNORMAL_CLASSES.has(cls)

  // Uncertain: the model isn't sure, or the beat is unclassified. Say so plainly.
  if (cls === 'Unclassified' || conf < t.minConfidence) {
    return { level: 'uncertain', label: 'Uncertain', detail: 'Low-confidence reading — not a diagnosis.' }
  }

  // Red/amber escalation only when THIS beat is itself abnormal — a confident
  // normal beat must never read as "Urgent" because of earlier beats.
  if (isAbnormal) {
    if (cls === 'Ventricular' && conf >= t.vConfidenceRed) {
      return { level: 'red', label: 'Urgent — review now', detail: `Confident ventricular beat (${Math.round(conf * 100)}%).` }
    }
    if (vCount >= t.vCountRedInWindow) {
      return { level: 'red', label: 'Urgent — review now', detail: `Ventricular run — ${vCount} of the last ${window.length} beats.` }
    }
    if (flags.includes('TACHY') || flags.includes('BRADY')) {
      return { level: 'red', label: 'Urgent — review now', detail: 'Abnormal rhythm with an abnormal heart rate.' }
    }
    return { level: 'amber', label: 'Caution', detail: `${cls} beat detected — keep watching.` }
  }

  // Current beat is normal and confident.
  if (abnormalCount >= t.abnormalCountAmberInWindow) {
    return { level: 'amber', label: 'Caution', detail: `Recent abnormal beats — ${abnormalCount} in the last ${window.length}.` }
  }
  if (flags.includes('IRREG')) {
    return { level: 'amber', label: 'Caution', detail: 'Irregular rhythm detected.' }
  }
  return { level: 'green', label: 'Normal', detail: 'Rhythm within normal limits.' }
}

// Severity ordering, handy for sorting or "highest alert in the last hour".
export const ALERT_RANK = { red: 4, amber: 3, uncertain: 2, green: 1, none: 0 }
