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
  WS_URL,
  exportUrl,
  fetchHistory,
  fetchLatest,
  fetchPatients,
  fetchStats,
  fetchTrends,
} from './api'
import { evaluateAlert } from './alerts'
import './App.css'

const USER_KEY = 'heartbeat_user'

// ── Fallback waveform (used only when the backend is offline) ─────────────────
const generatePoint = (index, phase) => {
  const t = index * 0.18 + phase
  const heartbeat = Math.sin(t) * 0.7 + Math.sin(t * 2.2) * 0.15 + Math.sin(t * 4.6) * 0.08
  return { x: index, value: 3.2 + heartbeat * 0.9 }
}
const INITIAL_POINTS = 60

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

// Prefer the alert the backend already computed; fall back to local logic offline.
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
function LoginScreen({ onSignIn }) {
  const [name, setName] = useState('')
  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSignIn(name.trim())
        }}
      >
        <div className="brand brand-center">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 12" width="32" height="12">
              <polyline
                points="0,6 7,6 10,2 13,10 16,1 19,11 22,6 32,6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand-name">Heartbeat</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Enter your name to open the ECG monitor.</p>
        <input
          className="login-input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" className="login-button" disabled={!name.trim()}>
          Continue
        </button>
        <p className="login-note">
          Identity only — no password. This is a research/education project, not a medical device.
        </p>
      </form>
    </div>
  )
}

// ── Trends view ───────────────────────────────────────────────────────────────
function TrendsView({ trends }) {
  const hr = (trends?.heart_rate || []).map((p, i) => ({ i, bpm: p.bpm }))
  const classDist = Object.entries(trends?.class_distribution || {}).map(([name, count]) => ({
    name,
    count,
  }))
  const alertDist = trends?.alert_distribution || {}

  return (
    <section className="trends">
      <div className="metrics">
        {['red', 'amber', 'green', 'uncertain'].map((lvl) => (
          <article key={lvl} className={`metric metric-alert alert-${lvl}`}>
            <p className="metric-label">{ALERT_LABEL[lvl]}</p>
            <p className="metric-value">{alertDist[lvl] || 0}</p>
          </article>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Heart rate over time</h2>
          <span className="panel-meta">{hr.length} beats</span>
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
        </div>
        <div className="waveform">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={classDist} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-dim)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis width={32} tick={{ fill: 'var(--text-faint)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--surface-2)' }}
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {classDist.map((entry) => (
                  <Cell key={entry.name} fill={CLASS_COLORS[entry.name] || 'var(--accent)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </section>
  )
}

// ── Main dashboard (everything after sign-in) ─────────────────────────────────
function Dashboard({ user, onSignOut }) {
  const [page, setPage] = useState('dashboard')
  const [connection, setConnection] = useState('connecting')

  const [patientFilter, setPatientFilter] = useState('All')
  const [patients, setPatients] = useState([])

  const [history, setHistory] = useState([])
  const [stats, setStats] = useState(null)
  const [latest, setLatest] = useState(null)
  const [trends, setTrends] = useState(null)
  const [waveform, setWaveform] = useState(() =>
    Array.from({ length: INITIAL_POINTS }, (_, i) => generatePoint(i, 0)),
  )

  // History page filters
  const [filterType, setFilterType] = useState('All')
  const [abnormalOnly, setAbnormalOnly] = useState(false)
  const [minConfidence, setMinConfidence] = useState('')

  const wsRef = useRef(null)
  const simRef = useRef(null)
  const patientParam = patientFilter === 'All' ? undefined : patientFilter

  // Initial + patient-scoped load
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchHistory({ limit: 100, patient: patientParam }),
      fetchStats(patientParam),
      fetchLatest(patientParam),
      fetchPatients().catch(() => []),
    ])
      .then(([h, s, l, p]) => {
        if (cancelled) return
        setHistory(Array.isArray(h) ? h : [])
        setStats(s)
        setLatest(l)
        if (Array.isArray(p)) setPatients(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [patientFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Trends refresh while on the trends tab
  useEffect(() => {
    if (page !== 'trends') return
    let active = true
    const load = () => fetchTrends(patientParam, 60).then((t) => active && setTrends(t)).catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [page, patientFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates over WebSocket
  useEffect(() => {
    let stopped = false
    let reconnectTimer = null
    const connect = () => {
      let ws
      try {
        ws = new WebSocket(WS_URL)
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
          setPatients((prev) => (prev.includes(beat.patient) ? prev : [...prev, beat.patient].sort()))
          // Respect the current patient filter for the live view.
          if (patientFilter !== 'All' && beat.patient !== patientFilter) return
          setLatest(beat)
          setHistory((prev) => [beat, ...prev].slice(0, 200))
          setStats((prev) => applyBeatToStats(prev, beat))
          if (Array.isArray(msg.samples) && msg.samples.length) {
            setWaveform(msg.samples.map((value, x) => ({ x, value })))
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = () => {
        if (stopped) return
        setConnection('offline')
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
  }, [patientFilter])

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
  const alert = useMemo(() => buildAlert(latest, history), [latest, history])
  const confidencePct = latest ? Math.round((latest.confidence || 0) * 100) : null
  const currentBpm = latest?.bpm != null ? Math.round(latest.bpm) : '—'
  const currentClass = latest?.classification ?? 'No data'

  const metrics = useMemo(
    () => [
      { label: 'Total beats', value: stats?.total_beats ?? 0 },
      { label: 'Abnormal beats', value: stats?.abnormal_beats ?? 0 },
      { label: 'Signal', value: connection === 'live' ? 'Streaming' : connection === 'connecting' ? '—' : 'Offline' },
    ],
    [stats, connection],
  )

  const filteredHistory = useMemo(() => {
    const minC = minConfidence ? parseFloat(minConfidence) : 0
    return history.filter(
      (r) =>
        (filterType === 'All' || r.classification === filterType) &&
        (!abnormalOnly || r.is_abnormal) &&
        (r.confidence || 0) >= minC,
    )
  }, [history, filterType, abnormalOnly, minConfidence])

  const exportHref = exportUrl({
    patient: patientParam,
    type: filterType === 'All' ? undefined : filterType,
    abnormal_only: abnormalOnly || undefined,
    min_confidence: minConfidence || undefined,
  })

  const loadMore = () =>
    fetchHistory({ limit: 50, offset: history.length, patient: patientParam })
      .then((older) => setHistory((prev) => [...prev, ...(Array.isArray(older) ? older : [])]))
      .catch(() => {})

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
          {patients.length > 0 && (
            <label className="patient-select">
              <select value={patientFilter} onChange={(e) => setPatientFilter(e.target.value)}>
                <option value="All">All patients</option>
                {patients.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className={`connection-pill connection-${connection}`}>
            <span className="connection-dot" aria-hidden="true" />
            {connectionLabel}
          </span>
          <div className="nav-tabs">
            {['dashboard', 'trends', 'history'].map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab ${page === tab ? 'active' : ''}`}
                onClick={() => setPage(tab)}
              >
                {tab === 'dashboard' ? 'Monitor' : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="user-menu">
            <span className="user-name" title={user}>
              {user}
            </span>
            <button type="button" className="signout" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

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
                {connection === 'live' ? 'Updating on each beat' : 'Simulated · offline'}
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
              </article>
            ))}
          </section>
        </>
      )}

      {page === 'trends' && <TrendsView trends={trends} />}

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
                  <th>Patient</th>
                  <th>Class</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      No readings match. Start the backend and device bridge to record beats.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((reading) => (
                    <tr key={reading.id ?? reading.recorded_at}>
                      <td className="mono">{new Date(reading.recorded_at).toLocaleString()}</td>
                      <td>{reading.patient}</td>
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
          <button type="button" className="load-more" onClick={loadMore}>
            Load older
          </button>
        </section>
      )}

      <footer className="disclaimer">
        Educational / research project. Not a medical device and not a diagnosis.
      </footer>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem(USER_KEY) || ''
    } catch {
      return ''
    }
  })

  if (!user) {
    return (
      <LoginScreen
        onSignIn={(name) => {
          try {
            localStorage.setItem(USER_KEY, name)
          } catch {
            /* ignore */
          }
          setUser(name)
        }}
      />
    )
  }

  return (
    <Dashboard
      user={user}
      onSignOut={() => {
        try {
          localStorage.removeItem(USER_KEY)
        } catch {
          /* ignore */
        }
        setUser('')
      }}
    />
  )
}

export default App
