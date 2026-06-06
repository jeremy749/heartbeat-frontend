import { useEffect, useMemo, useState } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import './App.css'

const generatePoint = (index, phase) => {
  const t = index * 0.18 + phase
  const heartbeat = Math.sin(t) * 0.7 + Math.sin(t * 2.2) * 0.15 + Math.sin(t * 4.6) * 0.08
  return {
    x: index,
    value: 3.2 + heartbeat * 0.9,
  }
}

const INITIAL_POINTS = 60

function App() {
  const [data, setData] = useState(() =>
    Array.from({ length: INITIAL_POINTS }, (_, index) => generatePoint(index, 0)),
  )
  const [phase, setPhase] = useState(0)
  const [page, setPage] = useState('dashboard')
  const [filterType, setFilterType] = useState('All')

  const historyData = useMemo(
    () => [
      { timestamp: '2026-06-06 11:05:42', classification: 'Normal', confidence: 92 },
      { timestamp: '2026-06-06 10:58:19', classification: 'Ventricular', confidence: 65 },
      { timestamp: '2026-06-06 10:51:06', classification: 'Supraventricular', confidence: 82 },
      { timestamp: '2026-06-06 10:44:30', classification: 'Fusion', confidence: 74 },
      { timestamp: '2026-06-06 10:38:11', classification: 'Normal', confidence: 89 },
      { timestamp: '2026-06-06 10:32:55', classification: 'Unclassified', confidence: 56 },
      { timestamp: '2026-06-06 10:26:38', classification: 'Normal', confidence: 95 },
      { timestamp: '2026-06-06 10:19:23', classification: 'Ventricular', confidence: 71 },
      { timestamp: '2026-06-06 10:12:08', classification: 'Supraventricular', confidence: 79 },
      { timestamp: '2026-06-06 10:05:51', classification: 'Fusion', confidence: 68 },
      { timestamp: '2026-06-06 09:59:14', classification: 'Normal', confidence: 94 },
    ],
    [],
  )

  const filteredHistory = useMemo(
    () =>
      filterType === 'All'
        ? historyData
        : historyData.filter((reading) => reading.classification === filterType),
    [filterType, historyData],
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((currentPhase) => {
        const nextPhase = currentPhase + 0.25
        setData((previous) => {
          const nextPoint = generatePoint(previous[previous.length - 1].x + 1, nextPhase)
          return [...previous.slice(1), nextPoint]
        })
        return nextPhase
      })
    }, 100)

    return () => clearInterval(interval)
  }, [])

  const stats = useMemo(
    () => [
      { label: 'Heart rate', value: '78 bpm' },
      { label: 'Signal quality', value: 'Excellent' },
      { label: 'Active leads', value: 'Lead I' },
    ],
    [],
  )

  const classification = useMemo(() => {
    const types = ['Normal', 'Ventricular', 'Supraventricular', 'Fusion', 'Unclassified']
    const confidences = [92, 65, 82, 74, 56]
    const index = Math.floor((phase / 8) % types.length)
    const type = types[index]
    const confidence = Math.min(100, Math.max(45, confidences[index] + Math.round(Math.sin(phase * 0.3) * 5)))

    return {
      type,
      confidence,
      badgeClass: type.toLowerCase().replace(/ /g, '-'),
    }
  }, [phase])

  return (
    <main className="dashboard-shell">
      <nav className="top-nav">
        <div className="user-profile">
          <span className="profile-icon" aria-hidden="true">👤</span>
          <div className="profile-copy">
            <p className="user-name">Dr. Jordan Lee</p>
            <p className="user-status">Monitoring dashboard</p>
          </div>
        </div>
        <div className="status-row">
          <span className={`classification-badge classification-${classification.badgeClass}`}>
            {classification.type}
          </span>
          <span className="confidence-pill">Confidence {classification.confidence}%</span>
          <div className="top-nav-links">
            <button
              type="button"
              className={`nav-pill ${page === 'dashboard' ? 'active' : ''}`}
              onClick={() => setPage('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-pill ${page === 'history' ? 'active' : ''}`}
              onClick={() => setPage('history')}
            >
              History
            </button>
          </div>
        </div>
      </nav>

      {page === 'dashboard' ? (
        <>
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">Live Patient Dashboard</p>
              <h1>ECG Monitor</h1>
              <p className="subtitle">
                Simulated live ECG waveform with smooth updates every 100ms.
              </p>
            </div>
            <div className="vitals-card">
              <span className="vitals-label">Current BPM</span>
              <strong>78</strong>
              <span className="vitals-tag">Stable</span>
            </div>
          </header>

          <section className="chart-card">
            <div className="chart-title-row">
              <div>
                <p className="eyebrow">Real-time ECG</p>
                <h2>Lead I waveform</h2>
              </div>
              <span className="chart-status">Updating every 100ms</span>
            </div>

            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 6" vertical={false} opacity={0.2} />
                  <XAxis dataKey="x" tick={false} axisLine={false} tickLine={false} />
                  <YAxis domain={[1.5, 4.8]} tickCount={5} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ stroke: '#ffffff22', strokeWidth: 1 }}
                    formatter={(value) => [`${value.toFixed(2)} mV`, 'ECG']}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#ff4f79"
                    strokeWidth={3}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="stats-grid">
            {stats.map((stat) => (
              <article key={stat.label} className="stat-card">
                <p className="stat-label">{stat.label}</p>
                <p className="stat-value">{stat.value}</p>
              </article>
            ))}
          </section>
        </>
      ) : (
        <section className="history-page">
          <div className="history-header">
            <div>
              <p className="eyebrow">Reading History</p>
              <h2>Past ECG classifications</h2>
            </div>
            <label className="filter-group">
              <span>Filter by type</span>
              <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                <option>All</option>
                <option>Normal</option>
                <option>Ventricular</option>
                <option>Supraventricular</option>
                <option>Fusion</option>
                <option>Unclassified</option>
              </select>
            </label>
          </div>

          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Classification</th>
                  <th>Confidence</th>
                  <th>Abnormal</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((reading) => (
                  <tr key={reading.timestamp + reading.classification}>
                    <td>{reading.timestamp}</td>
                    <td>{reading.classification}</td>
                    <td>{reading.confidence}%</td>
                    <td>
                      {reading.classification !== 'Normal' ? (
                        <span className="abnormal-flag" role="img" aria-label="Abnormal reading">
                          ⚠️
                        </span>
                      ) : (
                        <span className="normal-flag" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="chart-card">
        <div className="chart-title-row">
          <div>
            <p className="eyebrow">Real-time ECG</p>
            <h2>Lead I waveform</h2>
          </div>
          <span className="chart-status">Updating every 100ms</span>
        </div>

        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 6" vertical={false} opacity={0.2} />
              <XAxis dataKey="x" tick={false} axisLine={false} tickLine={false} />
              <YAxis domain={[1.5, 4.8]} tickCount={5} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ stroke: '#ffffff22', strokeWidth: 1 }}
                formatter={(value) => [`${value.toFixed(2)} mV`, 'ECG']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#ff4f79"
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="stats-grid">
        {stats.map((stat) => (
          <article key={stat.label} className="stat-card">
            <p className="stat-label">{stat.label}</p>
            <p className="stat-value">{stat.value}</p>
          </article>
        ))}
      </section>
    </main>
  )
}

export default App
