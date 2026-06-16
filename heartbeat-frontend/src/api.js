// Central place for talking to the heartbeat-backend.
// Override the URL at build time with VITE_API_URL (see .env.example).

export const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8000'

export const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws'

// ── Session token ─────────────────────────────────────────────────────────────
let authToken = null
let onAuthError = () => {}

export const setAuthToken = (t) => {
  authToken = t || null
}
export const setAuthErrorHandler = (fn) => {
  onAuthError = fn || (() => {})
}

const authHeaders = () => (authToken ? { Authorization: `Bearer ${authToken}` } : {})

const qs = (params = {}) => {
  const u = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.append(k, v)
  })
  const s = u.toString()
  return s ? `?${s}` : ''
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
  if (res.status === 401) {
    onAuthError() // token missing/expired -> let the app sign out
    throw new Error('UNAUTHORIZED')
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

// Sign in or sign up. Returns { id, name, token }. Throws 'UNAUTHORIZED' on a
// wrong password for an existing name.
export async function login(name, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(`login -> ${res.status}`)
  return res.json()
}

export async function logout() {
  try {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: authHeaders() })
  } catch {
    /* ignore */
  }
}

async function send(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    onAuthError()
    throw new Error('UNAUTHORIZED')
  }
  if (!res.ok) {
    let msg = `${path} -> ${res.status}`
    try {
      const d = await res.json()
      if (d.detail) msg = d.detail
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json().catch(() => null)
}

export const fetchHistory = (params = {}) => getJson(`/api/history${qs(params)}`)
export const fetchStats = () => getJson('/api/stats')
export const fetchLatest = () => getJson('/api/latest')
export const fetchTrends = (points) => getJson(`/api/trends${qs({ points })}`)
export const fetchAccount = () => getJson('/api/account')
export const fetchStrip = (count = 8) => getJson(`/api/strip${qs({ count })}`)

export const changePassword = (current_password, new_password) =>
  send('POST', '/api/change-password', { current_password, new_password })
export const deleteReadings = () => send('DELETE', '/api/account/readings')
export const deleteAccount = () => send('DELETE', '/api/account')

// Plain download links, so the token rides along as a query param.
export const exportUrl = (params = {}) =>
  `${API_BASE}/api/export.csv${qs({ ...params, token: authToken })}`
export const reportUrl = () => `${API_BASE}/api/report.pdf${qs({ token: authToken })}`
