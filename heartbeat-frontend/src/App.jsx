import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  WS_AUTH_CLOSE_CODES,
  changePassword as apiChangePassword,
  deleteAccount as apiDeleteAccount,
  deleteReadings as apiDeleteReadings,
  exportUrl,
  fetchAccount,
  fetchHistory,
  fetchLatest,
  fetchStats,
  fetchStrip,
  fetchTrends,
  login as apiLogin,
  logout as apiLogout,
  reportUrl,
  setAuthErrorHandler,
  setAuthToken,
  wsUrl,
} from './api'
import { evaluateAlert } from './alerts'
import ErrorBoundary from './ErrorBoundary.jsx'
import './App.css'

const USER_KEY = 'heartbeat_user'

const generatePoint = (index, phase) => {
  const t = index * 0.18 + phase
  const heartbeat = Math.sin(t) * 0.7 + Math.sin(t * 2.2) * 0.15 + Math.sin(t * 4.6) * 0.08
  return { x: index, value: 3.2 + heartbeat * 0.9 }
}
const INITIAL_POINTS = 60
const STREAM_IDLE_MS = 10000 // no beat for this long => not "streaming"
const HISTORY_PAGE = 200 // rows fetched for the history table
const LOAD_MORE_PAGE = 50 // rows added per "Load older"
// Ceiling on rows held in memory once the user has paged back through history.
const HISTORY_HARD_CAP = 2000
// Unfiltered recent beats kept for the alert engine. The alert must reflect the
// real rhythm, never whatever the history tab happens to be filtered to.
const ALERT_WINDOW = 25

const ALERT_ICON = { red: '⚠', amber: '!', green: '✓', uncertain: '?', none: '–' }
const ALERT_LABEL = {
  red: 'Urgent — review now',
  amber: 'Caution',
  green: 'Normal',
  uncertain: 'Uncertain',
  none: 'No data',
}
const CLASS_COLORS = {
  Normal: 'var(--green)',
  Ventricular: 'var(--red)',
  Supraventricular: 'var(--amber)',
  Fusion: 'var(--amber)',
  Unclassified: 'var(--text-faint)',
}

// Hover/focus explanations for the HRV metrics.
const INFO = {
  meanBpm: 'Mean heart rate — your average beats per minute over recent beats.',
  rmssd:
    'RMSSD — short-term, beat-to-beat heart-rate variability, in milliseconds. ' +
    'Higher often reflects a more relaxed, recovered state.',
  sdnn:
    'SDNN — overall heart-rate variability across the period, in milliseconds. ' +
    'Higher means more variation. Most meaningful over longer recordings.',
}

// What each beat classification means (plain, non-diagnostic).
const BEAT_TYPES = [
  ['Normal', "A normal beat from the heart's natural pacemaker."],
  ['Supraventricular', 'An early/abnormal beat starting above the ventricles (e.g. atrial).'],
  ['Ventricular', 'A beat starting in the ventricles (e.g. a PVC) — watched more closely.'],
  ['Fusion', 'A blend of a normal and a ventricular beat occurring together.'],
  ['Unclassified', 'The model could not confidently categorize this beat (or it was paced/unknown).'],
]

// A small "i" badge that shows an explanation on hover or keyboard focus.
function InfoDot({ text }) {
  return (
    <span className="info-dot" tabIndex={0} title={text} aria-label={text}>
      i
    </span>
  )
}

// Stable identity for a reading, used for React keys and for de-duplicating
// pages that overlap on their boundary timestamp.
const readingKey = (r) => r.id ?? r.recorded_at

// Oldest recorded_at in a set of readings, or null when there are none. Parsed
// rather than string-compared so mixed ISO offsets still order correctly.
const oldestTimestamp = (rows) => {
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

const applyBeatToStats = (prev, beat) => {
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

const buildAlert = (latest, history) => {
  if (!latest) return { level: 'none', label: 'No data', detail: 'Waiting for the first beat.' }
  if (latest.alert_level) {
    return {
      level: latest.alert_level,
      label: ALERT_LABEL[latest.alert_level] || latest.alert_level,
      detail: latest.alert_detail || '',
    }
  }
  return evaluateAlert(latest, history)
}

// ── Sign-in screen ────────────────────────────────────────────────────────────
function LoginScreen({ onSignedIn }) {
  const [name, setName] = useState('Demo User')
  const [password, setPassword] = useState('demo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !password) return
    setBusy(true)
    setError('')
    try {
      const user = await apiLogin(trimmed, password)
      onSignedIn(user)
    } catch (err) {
      setError(
        err.message === 'UNAUTHORIZED'
          ? 'Wrong password for that name.'
          : 'Could not reach the server. Is it running?',
      )
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-center">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 12" width="32" height="12">
              <polyline points="0,6 7,6 10,2 13,10 16,1 19,11 22,6 32,6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-name">Heartbeat</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">New name? The password you enter becomes that account's password.</p>
        <input
          className="login-input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="login-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="login-button" disabled={!name.trim() || !password || busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
        <p className="login-note">
          Demo login: <strong>Demo User</strong> / <strong>demo</strong>. Basic auth for a
          school project — not production security. Not a medical device.
        </p>
      </form>
    </div>
  )
}

// ── Trends view ───────────────────────────────────────────────────────────────
function TrendsView({ trends, strip, error }) {
  const hr = (trends?.heart_rate || []).map((p, i) => ({ i, bpm: p.bpm }))
  const classDist = Object.entries(trends?.class_distribution || {}).map(([name, count]) => ({ name, count }))
  const alertDist = trends?.alert_distribution || {}
  const points = trends?.points ?? hr.length
  const hrv = strip?.hrv || {}
  const stripData = (strip?.samples || []).map((value, x) => ({ x, value }))

  return (
    <section className="trends">
      {error && <p className="panel-error">{error}</p>}
      <div className="trends-toolbar">
        <a className="export-btn" href={reportUrl()} target="_blank" rel="noreferrer">
          Download PDF report
        </a>
      </div>

      <div className="metrics">
        <article className="metric">
          <p className="metric-label">
            Mean heart rate <InfoDot text={INFO.meanBpm} />
          </p>
          <p className="metric-value">{hrv.mean_bpm ?? '—'}</p>
          <p className="metric-sub">bpm</p>
        </article>
        <article className="metric">
          <p className="metric-label">
            HRV · RMSSD <InfoDot text={INFO.rmssd} />
          </p>
          <p className="metric-value">{hrv.rmssd ?? '—'}</p>
          <p className="metric-sub">ms (beat-to-beat)</p>
        </article>
        <article className="metric">
          <p className="metric-label">
            HRV · SDNN <InfoDot text={INFO.sdnn} />
          </p>
          <p className="metric-value">{hrv.sdnn ?? '—'}</p>
          <p className="metric-sub">ms (overall)</p>
        </article>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">ECG strip</h2>
          <span className="panel-meta">last {strip?.beats ?? 0} beats</span>
        </div>
        <div className="waveform">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stripData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={false} axisLine={false} tickLine={false} />
              <YAxis domain={['auto', 'auto']} tick={false} axisLine={false} tickLine={false} width={8} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
                formatter={(value) => [`${Number(value).toFixed(2)} mV`, 'ECG']}
                labelFormatter={() => ''}
              />
              <Line type="monotone" dataKey="value" stroke="var(--trace)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="metrics">
        {['red', 'amber', 'green', 'uncertain'].map((lvl) => (
          <article key={lvl} className={`metric metric-alert alert-${lvl}`}>
            <p className="metric-label">{ALERT_LABEL[lvl]}</p>
            <p className="metric-value">{alertDist[lvl] || 0}</p>
            <p className="metric-sub">all readings</p>
          </article>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Heart rate</h2>
          <span className="panel-meta">last {points} beats</span>
        </div>
        <div className="waveform">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={hr} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="i" tick={false} axisLine={false} tickLine={false} />
              <YAxis domain={['auto', 'auto']} width={32} tick={{ fill: 'var(--text-faint)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
                formatter={(value) => [`${Math.round(value)} bpm`, 'Heart rate']}
                labelFormatter={() => ''}
              />
              <Line type="monotone" dataKey="bpm" stroke="var(--trace)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Beats by type</h2>
          <span className="panel-meta">all readings</span>
        </div>
        <div className="waveform">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={classDist} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-dim)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis width={32} tick={{ fill: 'var(--text-faint)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {classDist.map((entry) => (
                  <Cell key={entry.name} fill={CLASS_COLORS[entry.name] || 'var(--accent)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">What the beat types mean</h2>
        </div>
        <ul className="beat-legend">
          {BEAT_TYPES.map(([name, desc]) => (
            <li key={name}>
              <span className="legend-dot" style={{ background: CLASS_COLORS[name] || 'var(--accent)' }} />
              <span className="legend-name">{name}</span>
              <span className="legend-desc">{desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

// ── Account view ──────────────────────────────────────────────────────────────
function AccountView({ onSignOut }) {
  const [account, setAccount] = useState(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = () =>
    fetchAccount()
      .then(setAccount)
      .catch((err) => {
        if (err.message !== 'UNAUTHORIZED') setMsg('Could not load your account details.')
      })
  useEffect(() => {
    refresh()
  }, [])

  const submitPassword = async (e) => {
    e.preventDefault()
    setMsg('')
    try {
      await apiChangePassword(current, next)
      setMsg('Password changed.')
      setCurrent('')
      setNext('')
    } catch (err) {
      setMsg(err.message === 'UNAUTHORIZED' ? 'Session expired.' : err.message)
    }
  }

  const clearReadings = async () => {
    if (!window.confirm('Delete ALL your readings? This cannot be undone.')) return
    try {
      await apiDeleteReadings()
      setMsg('All readings deleted.')
      refresh()
    } catch (err) {
      setMsg(err.message)
    }
  }

  const removeAccount = async () => {
    if (!window.confirm('Delete your entire account and all data? This cannot be undone.')) return
    try {
      await apiDeleteAccount()
      onSignOut()
    } catch (err) {
      setMsg(err.message)
    }
  }

  return (
    <section className="account">
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Account</h2>
        </div>
        <div className="account-info">
          <div>
            <span className="readout-label">Name</span>
            <p className="account-value">{account?.name ?? '—'}</p>
          </div>
          <div>
            <span className="readout-label">Created</span>
            <p className="account-value">
              {account?.created_at ? new Date(account.created_at).toLocaleDateString() : '—'}
            </p>
          </div>
          <div>
            <span className="readout-label">Readings</span>
            <p className="account-value">{account?.reading_count ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Change password</h2>
        </div>
        <form className="account-form" onSubmit={submitPassword}>
          <input className="login-input" type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="login-input" type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
          <button type="submit" className="login-button" disabled={!next}>
            Update password
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Danger zone</h2>
        </div>
        <div className="account-danger">
          <button type="button" className="danger-btn" onClick={clearReadings}>
            Delete all my readings
          </button>
          <button type="button" className="danger-btn danger-strong" onClick={removeAccount}>
            Delete my account
          </button>
        </div>
      </div>

      {msg && <p className="account-msg">{msg}</p>}
    </section>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
function Dashboard({ user, onSignOut }) {
  const userId = user.id
  const [page, setPage] = useState('dashboard')
  const [connection, setConnection] = useState('connecting')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [historyReloads, setHistoryReloads] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(null)
  const [allLoaded, setAllLoaded] = useState(false)
  const [summaryError, setSummaryError] = useState(null)
  const [trendsError, setTrendsError] = useState(null)
  const [recentBeats, setRecentBeats] = useState([])
  const [stats, setStats] = useState(null)
  const [latest, setLatest] = useState(null)
  const [trends, setTrends] = useState(null)
  const [strip, setStrip] = useState(null)
  const [waveform, setWaveform] = useState(() =>
    Array.from({ length: INITIAL_POINTS }, (_, i) => generatePoint(i, 0)),
  )
  const [lastBeatAt, setLastBeatAt] = useState(0)
  const [, setTick] = useState(0)

  const [filterType, setFilterType] = useState('All')
  const [abnormalOnly, setAbnormalOnly] = useState(false)
  const [minConfidence, setMinConfidence] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Convert a yyyy-mm-dd input into an ISO timestamp bound (start/end of day).
  const since = dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined
  const until = dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined

  // Every filter the server understands, in one object. The table, "Load older"
  // and the CSV export all send exactly this, so the export can never contain
  // rows the table never showed.
  const historyParams = useMemo(
    () => ({
      type: filterType === 'All' ? undefined : filterType,
      abnormal_only: abnormalOnly || undefined,
      min_confidence: minConfidence || undefined,
      since,
      until,
    }),
    [filterType, abnormalOnly, minConfidence, since, until],
  )

  const wsRef = useRef(null)
  const simRef = useRef(null)
  // Held in a ref so the socket effect can sign out without listing onSignOut
  // as a dependency - its identity changes on every parent render, which would
  // tear down and reopen the socket continuously.
  const signOutRef = useRef(onSignOut)
  useEffect(() => {
    signOutRef.current = onSignOut
  })

  // Periodic re-render so the "streaming vs waiting" label stays honest.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  // History table — refetched whenever a filter changes, so filtering is the
  // server's job and the table matches the CSV export row for row.
  useEffect(() => {
    let cancelled = false
    setAllLoaded(false)
    setHistoryLoading(true)
    setHistoryError(null)
    setLoadMoreError(null)
    fetchHistory({ ...historyParams, limit: HISTORY_PAGE })
      .then((h) => {
        if (cancelled) return
        const rows = Array.isArray(h) ? h : []
        setHistory(rows)
        // A short first page means there is nothing older to ask for, so don't
        // offer a "Load older" that can only come back empty.
        setAllLoaded(rows.length < HISTORY_PAGE)
        setHistoryLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setHistoryLoading(false)
        // A 401 already signs the user out; don't also shout about it.
        if (err.message !== 'UNAUTHORIZED') setHistoryError('Could not load readings.')
      })
    return () => {
      cancelled = true
    }
  }, [userId, historyParams, historyReloads])

  // Summary data plus the unfiltered beat window the alert engine runs on.
  useEffect(() => {
    let cancelled = false
    setSummaryError(null)
    Promise.all([fetchStats(), fetchLatest(), fetchHistory({ limit: ALERT_WINDOW })])
      .then(([s, l, recent]) => {
        if (cancelled) return
        setStats(s)
        setLatest(l)
        setRecentBeats(Array.isArray(recent) ? recent : [])
      })
      .catch((err) => {
        if (cancelled || err.message === 'UNAUTHORIZED') return
        setSummaryError('Could not load your latest readings — figures may be stale.')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Trends refresh while on the trends tab
  useEffect(() => {
    if (page !== 'trends') return
    let active = true
    const load = () => {
      Promise.all([fetchTrends(60), fetchStrip(8)])
        .then(([t, s]) => {
          if (!active) return
          setTrends(t)
          setStrip(s)
          setTrendsError(null)
        })
        .catch((err) => {
          if (!active || err.message === 'UNAUTHORIZED') return
          setTrendsError('Could not refresh trends — retrying every few seconds.')
        })
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [page, userId])

  // Live updates over WebSocket
  useEffect(() => {
    let stopped = false
    let reconnectTimer = null
    const connect = () => {
      let ws
      try {
        ws = new WebSocket(wsUrl())
      } catch {
        setConnection('offline')
        return
      }
      wsRef.current = ws
      ws.onopen = () => setConnection('live')
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type !== 'beat') return
          const beat = msg.data
          // Defence in depth. The server authenticates the socket and should
          // only ever send this user's beats; drop anything else that arrives.
          if (beat.user_id != null && beat.user_id !== userId) return
          setLastBeatAt(Date.now())
          setLatest(beat)
          setRecentBeats((prev) => [beat, ...prev].slice(0, ALERT_WINDOW))
          // Grow past HISTORY_PAGE rather than truncating: once the user has
          // paged back through history, a single live beat must not throw
          // those loaded pages away.
          setHistory((prev) =>
            [beat, ...prev].slice(0, Math.min(HISTORY_HARD_CAP, Math.max(HISTORY_PAGE, prev.length + 1))),
          )
          setStats((prev) => applyBeatToStats(prev, beat))
          if (Array.isArray(msg.samples) && msg.samples.length) {
            setWaveform(msg.samples.map((value, x) => ({ x, value })))
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = (event) => {
        if (stopped) return
        setConnection('offline')
        if (WS_AUTH_CLOSE_CODES.has(event.code)) {
          // The server rejected our token. Retrying cannot fix that.
          stopped = true
          signOutRef.current()
          return
        }
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (wsRef.current) wsRef.current.close()
    }
  }, [userId])

  // Offline-only simulated trace
  useEffect(() => {
    if (connection === 'live') {
      if (simRef.current) {
        clearInterval(simRef.current)
        simRef.current = null
      }
      return
    }
    let phase = 0
    simRef.current = setInterval(() => {
      phase += 0.25
      setWaveform((prev) => {
        const nextX = prev.length ? prev[prev.length - 1].x + 1 : 0
        return [...prev.slice(-(INITIAL_POINTS - 1)), generatePoint(nextX, phase)]
      })
    }, 100)
    return () => {
      if (simRef.current) {
        clearInterval(simRef.current)
        simRef.current = null
      }
    }
  }, [connection])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const alert = useMemo(() => buildAlert(latest, recentBeats), [latest, recentBeats])
  const confidencePct = latest ? Math.round((latest.confidence || 0) * 100) : null
  const currentBpm = latest?.bpm != null ? Math.round(latest.bpm) : '—'
  const currentClass = latest?.classification ?? 'No data'

  const recentlyStreaming = lastBeatAt > 0 && Date.now() - lastBeatAt < STREAM_IDLE_MS
  const signalLabel =
    connection !== 'live' ? 'Offline' : recentlyStreaming ? 'Streaming' : 'Waiting for data'

  const metrics = [
    { label: 'Total beats', value: stats?.total_beats ?? 0, sub: 'all readings' },
    { label: 'Abnormal beats', value: stats?.abnormal_beats ?? 0, sub: 'all readings' },
    { label: 'Signal', value: signalLabel, sub: connection === 'live' ? 'backend connected' : 'backend offline' },
  ]

  // The server already applied these filters to what it sent. This second pass
  // exists only for beats that arrive live over the socket, which bypass it.
  const filteredHistory = useMemo(() => {
    const minC = minConfidence ? parseFloat(minConfidence) : 0
    const sinceMs = since ? Date.parse(since) : null
    const untilMs = until ? Date.parse(until) : null
    return history.filter((r) => {
      if (filterType !== 'All' && r.classification !== filterType) return false
      if (abnormalOnly && !r.is_abnormal) return false
      if ((r.confidence || 0) < minC) return false
      const at = Date.parse(r.recorded_at)
      if (sinceMs != null && at < sinceMs) return false
      if (untilMs != null && at > untilMs) return false
      return true
    })
  }, [history, filterType, abnormalOnly, minConfidence, since, until])

  const exportHref = exportUrl(historyParams)

  const hasFilters =
    filterType !== 'All' || abnormalOnly || minConfidence !== '' || dateFrom !== '' || dateTo !== ''

  // Page by timestamp, not by offset. Beats keep being recorded while the user
  // reads, and every new row shifts an offset-based window by one - which
  // silently duplicates rows at the seam and skips others entirely. Asking for
  // "older than the oldest row I hold" is stable under insertions.
  const loadMore = () => {
    if (loadingMore || allLoaded) return
    const oldest = oldestTimestamp(history)
    if (!oldest) return
    setLoadingMore(true)
    setLoadMoreError(null)
    fetchHistory({ ...historyParams, limit: LOAD_MORE_PAGE, until: oldest })
      .then((older) => {
        const rows = Array.isArray(older) ? older : []
        // `until` is inclusive, so the boundary row comes back with the page.
        const seen = new Set(history.map(readingKey))
        const added = rows.filter((r) => !seen.has(readingKey(r)))
        if (added.length) setHistory((prev) => [...prev, ...added])
        setAllLoaded(added.length === 0 || rows.length < LOAD_MORE_PAGE)
        setLoadingMore(false)
      })
      .catch((err) => {
        setLoadingMore(false)
        if (err.message !== 'UNAUTHORIZED') setLoadMoreError('Could not load older readings.')
      })
  }

  const retryHistory = () => setHistoryReloads((n) => n + 1)

  const connectionLabel =
    connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Offline · demo'

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 12" width="32" height="12">
              <polyline points="0,6 7,6 10,2 13,10 16,1 19,11 22,6 32,6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-name">Heartbeat</span>
        </div>

        <div className="nav-right">
          <span className={`connection-pill connection-${connection}`}>
            <span className="connection-dot" aria-hidden="true" />
            {connectionLabel}
          </span>
          <div className="nav-tabs">
            {['dashboard', 'trends', 'history', 'account'].map((tab) => (
              <button key={tab} type="button" className={`tab ${page === tab ? 'active' : ''}`} onClick={() => setPage(tab)}>
                {tab === 'dashboard' ? 'Monitor' : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="user-menu">
            <span className="user-name" title={user.name}>
              {user.name}
            </span>
            <button type="button" className="signout" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Renders children untouched until something throws, so the shell and
          nav survive a bad payload and the user can switch tabs. Keyed on the
          page so moving tabs clears a previous failure. */}
      <ErrorBoundary key={page} title="This view failed to render">
      {page === 'dashboard' && (
        <>
          <section className={`alert-banner alert-${alert.level}`} role="status">
            <span className="alert-icon" aria-hidden="true">
              {ALERT_ICON[alert.level]}
            </span>
            <div className="alert-text">
              <p className="alert-label">{alert.label}</p>
              <p className="alert-detail">{alert.detail}</p>
            </div>
          </section>

          <section className="monitor-header">
            <div className="monitor-title">
              <p className="eyebrow">Live ECG monitor</p>
              <h1>
                {currentClass}
                {confidencePct != null && <span className="title-conf"> · {confidencePct}%</span>}
              </h1>
            </div>
            <div className="readout-cluster">
              <div className="readout">
                <span className="readout-label">Heart rate</span>
                <span className="readout-value">
                  {currentBpm}
                  <small> bpm</small>
                </span>
              </div>
              <div className="readout">
                <span className="readout-label">Confidence</span>
                <span className="readout-value">
                  {confidencePct ?? '—'}
                  <small> %</small>
                </span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Latest beat</h2>
              <span className="panel-meta">
                {recentlyStreaming ? 'Updating on each beat' : connection === 'live' ? 'Connected · waiting for data' : 'Simulated · offline'}
              </span>
            </div>
            <div className="waveform">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={waveform} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="x" tick={false} axisLine={false} tickLine={false} />
                  <YAxis domain={['auto', 'auto']} tick={false} axisLine={false} tickLine={false} width={8} />
                  <Tooltip
                    cursor={{ stroke: 'var(--trace)', strokeOpacity: 0.3 }}
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
                    formatter={(value) => [`${Number(value).toFixed(2)} mV`, 'ECG']}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--trace)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="metrics">
            {metrics.map((metric) => (
              <article key={metric.label} className="metric">
                <p className="metric-label">{metric.label}</p>
                <p className="metric-value">{metric.value}</p>
                <p className="metric-sub">{metric.sub}</p>
              </article>
            ))}
          </section>

          {summaryError && <p className="panel-error">{summaryError}</p>}
        </>
      )}

      {page === 'trends' && <TrendsView trends={trends} strip={strip} error={trendsError} />}

      {page === 'account' && <AccountView onSignOut={onSignOut} />}

      {page === 'history' && (
        <section className="history">
          <div className="history-head">
            <div>
              <p className="eyebrow">Reading history</p>
              <h2 className="panel-title">Past classifications</h2>
            </div>
            <div className="history-controls">
              <label className="filter">
                <span>Type</span>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                  <option>All</option>
                  <option>Normal</option>
                  <option>Ventricular</option>
                  <option>Supraventricular</option>
                  <option>Fusion</option>
                  <option>Unclassified</option>
                </select>
              </label>
              <label className="filter">
                <span>Min confidence</span>
                <select value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)}>
                  <option value="">Any</option>
                  <option value="0.6">≥ 60%</option>
                  <option value="0.8">≥ 80%</option>
                  <option value="0.9">≥ 90%</option>
                </select>
              </label>
              <label className="filter">
                <span>From</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="filter">
                <span>To</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label className="filter filter-check">
                <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />
                <span>Abnormal only</span>
              </label>
              <a className="export-btn" href={exportHref} download>
                Export CSV
              </a>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Class</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Loading readings…
                    </td>
                  </tr>
                ) : historyError ? (
                  <tr>
                    <td colSpan={4} className="empty empty-error">
                      {historyError}{' '}
                      <button type="button" className="retry-btn" onClick={retryHistory}>
                        Retry
                      </button>
                    </td>
                  </tr>
                ) : filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      {hasFilters
                        ? 'No readings match these filters.'
                        : 'No readings yet. Start the backend and a data feed to record beats.'}
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((reading) => (
                    <tr key={readingKey(reading)}>
                      <td className="mono">{new Date(reading.recorded_at).toLocaleString()}</td>
                      <td>{reading.classification}</td>
                      <td className="mono">{Math.round((reading.confidence || 0) * 100)}%</td>
                      <td>
                        <span className={`alert-dot alert-${reading.alert_level || (reading.is_abnormal ? 'amber' : 'green')}`} aria-hidden="true" />
                        {reading.alert_level ? ALERT_LABEL[reading.alert_level] : reading.is_abnormal ? 'Abnormal' : 'Normal'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {loadMoreError && <p className="panel-error">{loadMoreError}</p>}
          {allLoaded ? (
            <p className="load-more-done">No older readings.</p>
          ) : (
            <button
              type="button"
              className="load-more"
              onClick={loadMore}
              disabled={loadingMore || history.length === 0}
            >
              {loadingMore ? 'Loading…' : 'Load older'}
            </button>
          )}
        </section>
      )}
      </ErrorBoundary>

      <footer className="disclaimer">
        Educational / research project. Not a medical device and not a diagnosis.
      </footer>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  // Set the token synchronously (before any child data fetch runs).
  if (user?.token) setAuthToken(user.token)

  const signOut = () => {
    apiLogout()
    setAuthToken(null)
    try {
      localStorage.removeItem(USER_KEY)
    } catch {
      /* ignore */
    }
    setUser(null)
  }

  // If the server ever rejects our token (e.g. database reset), sign out.
  useEffect(() => {
    setAuthErrorHandler(signOut)
  }, [])

  if (!user) {
    return (
      <LoginScreen
        onSignedIn={(u) => {
          setAuthToken(u.token)
          try {
            localStorage.setItem(USER_KEY, JSON.stringify(u))
          } catch {
            /* ignore */
          }
          setUser(u)
        }}
      />
    )
  }

  return <Dashboard user={user} onSignOut={signOut} />
}

export default App
