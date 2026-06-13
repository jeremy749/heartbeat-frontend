// Central place for talking to the heartbeat-backend.
// Override the URL at build time with VITE_API_URL (see .env.example).

export const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8000'

export const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws'

const qs = (params = {}) => {
  const u = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.append(k, v)
  })
  const s = u.toString()
  return s ? `?${s}` : ''
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

export const fetchHistory = (params = {}) => getJson(`/api/history${qs(params)}`)
export const fetchStats = (patient) => getJson(`/api/stats${qs({ patient })}`)
export const fetchLatest = (patient) => getJson(`/api/latest${qs({ patient })}`)
export const fetchTrends = (patient, points) => getJson(`/api/trends${qs({ patient, points })}`)
export const fetchPatients = () => getJson('/api/patients')
export const exportUrl = (params = {}) => `${API_BASE}/api/export.csv${qs(params)}`
