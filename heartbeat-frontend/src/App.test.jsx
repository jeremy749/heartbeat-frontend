// Component tests for the app shell. Run with `npm run test:ui` (or `npm test`).
//
// These go through <App /> rather than importing LoginScreen or Dashboard
// directly, because those are not exported - and testing the real entry point
// means the routing between them is covered too, rather than mocked away.
//
// The API module is stubbed per test; everything else is real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(),
    fetchStats: vi.fn(),
    fetchLatest: vi.fn(),
    fetchHistory: vi.fn(),
    fetchTrends: vi.fn(),
    fetchStrip: vi.fn(),
    fetchAccount: vi.fn(),
  }
})

const api = await import('./api')
const { default: App } = await import('./App.jsx')

const USER_KEY = 'heartbeat_user'
const signedIn = { id: 1, name: 'Alice', token: 'tok' }

// jsdom has no WebSocket worth using here; the app only needs the constructor
// to succeed and the handlers to be assignable. Leaving them unfired keeps the
// connection in its "connecting" state, which is what an unreachable backend
// looks like from the UI's point of view.
class SilentWebSocket {
  constructor(url) {
    this.url = url
    SilentWebSocket.instances.push(this)
  }
  close() {}
}
SilentWebSocket.instances = []

beforeEach(() => {
  SilentWebSocket.instances = []
  globalThis.WebSocket = SilentWebSocket
  localStorage.clear()
  api.fetchStats.mockResolvedValue({ total_beats: 0, abnormal_beats: 0, counts_by_class: {} })
  api.fetchLatest.mockResolvedValue(null)
  api.fetchHistory.mockResolvedValue([])
  api.fetchTrends.mockResolvedValue({})
  api.fetchStrip.mockResolvedValue({})
  api.fetchAccount.mockResolvedValue({ name: 'Alice', reading_count: 0 })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('signed out', () => {
  it('shows the sign-in form', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('reports a wrong password as its own thing', async () => {
    api.login.mockRejectedValue(new Error('UNAUTHORIZED'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText(/wrong password/i)).toBeTruthy()
  })

  it('reports an unreachable server as its own thing', async () => {
    api.login.mockRejectedValue(new Error('boom'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy()
  })

  it('reports a throttled sign-in with the wait, not as a dead server', async () => {
    // The regression the api suite covers at the transport level, checked here
    // at the level the user actually experiences.
    const err = new Error('RATE_LIMITED')
    err.retryAfter = 42
    api.login.mockRejectedValue(err)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText(/too many failed attempts.*42/i)).toBeTruthy()
    expect(screen.queryByText(/could not reach the server/i)).toBeNull()
  })

  it('signs in and lands on the monitor', async () => {
    api.login.mockResolvedValue(signedIn)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText(/live ecg monitor/i)).toBeTruthy()
  })
})

describe('signed in · first run', () => {
  beforeEach(() => {
    localStorage.setItem(USER_KEY, JSON.stringify(signedIn))
  })

  it('explains how to connect a device when the account has no readings', async () => {
    render(<App />)
    expect(await screen.findByText(/no readings yet — connect a device/i)).toBeTruthy()
    expect(screen.getByText(/HEARTBEAT_DEVICE_KEY/)).toBeTruthy()
    expect(screen.getByText(/device_bridge\.py --demo/)).toBeTruthy()
  })

  it('does not offer setup steps when the backend is simply down', async () => {
    // "You have no data" and "we could not ask" are different answers, and
    // telling someone to connect a device when their server is down is wrong.
    api.fetchStats.mockRejectedValue(new Error('network'))
    api.fetchLatest.mockRejectedValue(new Error('network'))
    api.fetchHistory.mockRejectedValue(new Error('network'))
    render(<App />)
    expect(await screen.findByText(/could not load your latest readings/i)).toBeTruthy()
    expect(screen.queryByText(/connect a device/i)).toBeNull()
  })

  it('hides the setup steps once readings exist', async () => {
    api.fetchStats.mockResolvedValue({ total_beats: 12, abnormal_beats: 1, counts_by_class: {} })
    api.fetchLatest.mockResolvedValue({
      id: 1,
      recorded_at: new Date().toISOString(),
      classification: 'Normal',
      confidence: 0.97,
      bpm: 71,
      is_abnormal: false,
    })
    render(<App />)
    expect(await screen.findByText(/live ecg monitor/i)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/connect a device/i)).toBeNull())
  })
})

describe('signed in · the trace is never mistaken for a reading', () => {
  beforeEach(() => {
    localStorage.setItem(USER_KEY, JSON.stringify(signedIn))
  })

  it('marks the trace as a demo while the socket is down', async () => {
    render(<App />)
    expect(await screen.findByText(/demo trace — not your data/i)).toBeTruthy()
  })

  it('keeps it marked after the socket opens, until a beat actually arrives', async () => {
    // The regression this guards: the flag followed the socket, not the data.
    // The moment the connection opened, the synthetic points already on screen
    // were restyled as a real reading - solid, uncaptioned - and stayed that way
    // for as long as no beat carried samples. On a backend with no device
    // attached, that is forever.
    render(<App />)
    await screen.findByText(/demo trace — not your data/i)

    const socket = SilentWebSocket.instances.at(-1)
    await act(async () => {
      socket.onopen()
    })

    expect(screen.getByText(/demo trace — not your data/i)).toBeTruthy()
  })

  it('drops the demo marking once a beat brings real samples', async () => {
    render(<App />)
    await screen.findByText(/demo trace — not your data/i)

    const socket = SilentWebSocket.instances.at(-1)
    await act(async () => {
      socket.onopen()
      socket.onmessage({
        data: JSON.stringify({
          type: 'beat',
          data: {
            id: 7,
            user_id: 1,
            recorded_at: new Date().toISOString(),
            classification: 'Normal',
            confidence: 0.96,
            bpm: 68,
            is_abnormal: false,
          },
          samples: [0.1, 0.4, 1.2, 0.3, 0.1],
        }),
      })
    })

    await waitFor(() => expect(screen.queryByText(/demo trace — not your data/i)).toBeNull())
  })

  it('ignores a beat belonging to someone else', async () => {
    render(<App />)
    await screen.findByText(/demo trace — not your data/i)

    const socket = SilentWebSocket.instances.at(-1)
    await act(async () => {
      socket.onopen()
      socket.onmessage({
        data: JSON.stringify({
          type: 'beat',
          data: { id: 9, user_id: 999, classification: 'Ventricular', confidence: 0.9 },
          samples: [1, 2, 3],
        }),
      })
    })

    // Another account's samples must not become this account's trace.
    expect(screen.getByText(/demo trace — not your data/i)).toBeTruthy()
  })
})
