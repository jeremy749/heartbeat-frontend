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
} from './api'
import { evaluateAlert } from './alerts'
import './App.css'

const USER_KEY = 'heartbeat_user'

const generatePoint = (index, phase) => {
  const t = index * 0.18 + phase
  const heartbeat = Math.sin(t) * 0.7 + Math.sin(t * 2.2) * 0.15 + Math.sin(t * 4.6) * 0.08
  return { x: index, value: 3.2 + heartbeat * 0.9 }
}
const INITIAL_POINTS = 60
const STREAM_IDLE_MS = 10000 // no beat for this long => not "streaming"

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
function TrendsView({ trends, strip }) {
  const hr = (trends?.heart_rate || []).map((p, i) => ({ i, bpm: p.bpm }))
  const classDist = Object.entries(trends?.class_distribution || {}).map(([name, count]) => ({ name, count }))
  const alertDist = trends?.alert_distribution || {}
  const points = trends?.points ?? hr.length
  const hrv = strip?.hrv || {}
  const stripData = (strip?.samples || []).map((value, x) => ({ x, value }))

  return (
    <section className="trends">
      <div className="trends-toolbar">
        <a className="export-btn" href={reportUrl()} target="_blank" rel="noreferrer">
          Download PDF report
        </a>
      </div>

      <div className="metrics">
        <article className="metric">
          <p className="metric-label">Mean heart rate</p>
          <p className="metric-value">{hrv.mean_bpm ?? '—'}</p>
          <p className="metric-sub">bpm</p>
        </article>
        <article className="metric">
          <p className="metric-label">HRV · RMSSD</p>
          <p className="metric-value">{hrv.rmssd ?? '—'}</p>
          <p className="metric-sub">ms (beat-to-beat)</p>
        </article>
        <article className="metric">
          <p className="metric-label">HRV · SDNN</p>
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
    </section>
  )
}

// ── Account view ──────────────────────────────────────────────────────────────
function AccountView({ onSignOut }) {
  const [account, setAccount] = useState(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = () => fetchAccount().then(setAccount).catch(() => {})
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

  const wsRef = useRef(null)
  const simRef = useRef(null)

  // Periodic re-render so the "streaming vs waiting" label stays honest.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  // Initial load (scoped to this user)
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchHistory({ limit: 100 }), fetchStats(), fetchLatest()])
      .then(([h, s, l]) => {
        if (cancelled) return
        setHistory(Array.isArray(h) ? h : [])
        setStats(s)
        setLatest(l)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId])

  // Trends refresh while on the trends tab
  useEffect(() => {
    if (page !== 'trends') return
    let active = true
    const load = () => {
      fetchTrends(60).then((t) => active && setTrends(t)).catch(() => {})
      fetchStrip(8).then((s) => active && setStrip(s)).catch(() => {})
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
          // Single-user: only show beats that belong to the signed-in user.
          if (beat.user_id != null && beat.user_id !== userId) return
          setLastBeatAt(Date.now())
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
  const alert = useMemo(() => buildAlert(latest, history), [latest, history])
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
    type: filterType === 'All' ? undefined : filterType,
    abnormal_only: abnormalOnly || undefined,
    min_confidence: minConfidence || undefined,
  })

  const loadMore = () =>
    fetchHistory({ limit: 50, offset: history.length })
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
        </>
      )}

      {page === 'trends' && <TrendsView trends={trends} strip={strip} />}

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
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      No readings yet. Start the backend and a data feed to record beats.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((reading) => (
                    <tr key={reading.id ?? reading.recorded_at}>
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
