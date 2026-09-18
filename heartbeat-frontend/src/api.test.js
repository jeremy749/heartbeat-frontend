import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  API_BASE,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  exportUrl,
  fetchTicket,
  login,
  reconnectDelay,
  reportUrl,
  setAuthErrorHandler,
  setAuthToken,
  wsUrl,
} from './api.js'

const realFetch = globalThis.fetch

// Minimal stand-in for a fetch Response: only what api.js actually reads.
const stubResponse = ({ status, body = {}, headers = {} }) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  headers: { get: (name) => headers[name] ?? null },
})

const stubFetch = (response) => {
  globalThis.fetch = async () => response
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('login', () => {
  it('returns the account on success', async () => {
    stubFetch(stubResponse({ status: 200, body: { id: 1, name: 'Alice', token: 't', created: true } }))
    assert.deepEqual(await login('Alice', 'pw'), {
      id: 1,
      name: 'Alice',
      token: 't',
      created: true,
    })
  })

  it('reports a wrong password distinctly', async () => {
    stubFetch(stubResponse({ status: 401 }))
    await assert.rejects(login('Alice', 'nope'), { message: 'UNAUTHORIZED' })
  })

  // The regression: a throttled sign-in used to fall through to the generic
  // branch, and the UI told the user the server was unreachable - sending them
  // off to restart a backend that was up and deliberately refusing them.
  it('reports a throttled sign-in as its own condition, not as a dead server', async () => {
    stubFetch(
      stubResponse({
        status: 429,
        body: { detail: 'Too many failed sign-in attempts. Try again in 42s.' },
        headers: { 'Retry-After': '42' },
      }),
    )
    await assert.rejects(login('Alice', 'nope'), (err) => {
      assert.equal(err.message, 'RATE_LIMITED')
      assert.equal(err.detail, 'Too many failed sign-in attempts. Try again in 42s.')
      assert.equal(err.retryAfter, 42)
      return true
    })
  })

  it('still carries the wait when Retry-After is not readable', async () => {
    // Cross-origin, Retry-After is only readable because the API exposes it;
    // the body must be enough on its own.
    stubFetch(
      stubResponse({
        status: 429,
        body: { detail: 'Too many failed sign-in attempts. Try again in 9s.' },
      }),
    )
    await assert.rejects(login('Alice', 'nope'), (err) => {
      assert.equal(err.message, 'RATE_LIMITED')
      assert.equal(err.detail, 'Too many failed sign-in attempts. Try again in 9s.')
      assert.equal(err.retryAfter, null)
      return true
    })
  })

  it('survives a 429 with an unreadable body', async () => {
    globalThis.fetch = async () => ({
      status: 429,
      ok: false,
      json: async () => {
        throw new Error('not json')
      },
      headers: { get: () => '30' },
    })
    await assert.rejects(login('Alice', 'nope'), (err) => {
      assert.equal(err.message, 'RATE_LIMITED')
      assert.equal(err.detail, null)
      assert.equal(err.retryAfter, 30)
      return true
    })
  })

  it('passes other failures through with their status', async () => {
    stubFetch(stubResponse({ status: 500 }))
    await assert.rejects(login('Alice', 'pw'), { message: 'login -> 500' })
  })
})

describe('reconnectDelay', () => {
  // Jitter is injected so the schedule is deterministic under test.
  const noJitter = () => 1 // -> the full ceiling
  const minJitter = () => 0 // -> half the ceiling

  it('backs off exponentially from the base delay', () => {
    assert.equal(reconnectDelay(0, noJitter), RECONNECT_BASE_MS)
    assert.equal(reconnectDelay(1, noJitter), RECONNECT_BASE_MS * 2)
    assert.equal(reconnectDelay(2, noJitter), RECONNECT_BASE_MS * 4)
    assert.equal(reconnectDelay(3, noJitter), RECONNECT_BASE_MS * 8)
  })

  it('holds at the ceiling instead of growing without bound', () => {
    // Attempt 20 would be ~12 days without the cap.
    assert.equal(reconnectDelay(20, noJitter), RECONNECT_MAX_MS)
    assert.equal(reconnectDelay(100, noJitter), RECONNECT_MAX_MS)
  })

  it('never waits less than half the ceiling, so retries stay spread out', () => {
    assert.equal(reconnectDelay(0, minJitter), RECONNECT_BASE_MS / 2)
    assert.equal(reconnectDelay(20, minJitter), RECONNECT_MAX_MS / 2)
  })

  it('stays inside its bounds with real jitter', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
      for (let i = 0; i < 50; i += 1) {
        const wait = reconnectDelay(attempt)
        assert.ok(wait >= ceiling / 2, `attempt ${attempt}: ${wait} below half the ceiling`)
        assert.ok(wait <= ceiling, `attempt ${attempt}: ${wait} above the ceiling`)
      }
    }
  })

  it('defaults to the first attempt', () => {
    const wait = reconnectDelay()
    assert.ok(wait >= RECONNECT_BASE_MS / 2 && wait <= RECONNECT_BASE_MS)
  })
})

// A session token is valid for thirty days and a URL ends up in the server's
// access log and the browser's history, so nothing here may put one in a query
// string. Downloads and the socket carry a one-use ticket instead.
describe('tickets', () => {
  const ticketResponse = () => stubResponse({ status: 200, body: { ticket: 'TKT', expires_in: 60 } })

  it('mints a ticket', async () => {
    stubFetch(ticketResponse())
    assert.equal(await fetchTicket(), 'TKT')
  })

  it('sends the session token in the header, never the URL', async () => {
    setAuthToken('SESSION-TOKEN')
    let seen = null
    globalThis.fetch = async (url, init) => {
      seen = { url, init }
      return ticketResponse()
    }
    await fetchTicket()
    setAuthToken(null)

    assert.equal(seen.init.method, 'POST')
    assert.equal(seen.init.headers.Authorization, 'Bearer SESSION-TOKEN')
    assert.ok(!String(seen.url).includes('SESSION-TOKEN'), seen.url)
  })

  it('puts a ticket in the socket URL, not the session token', async () => {
    setAuthToken('SESSION-TOKEN')
    stubFetch(ticketResponse())
    const url = await wsUrl()
    setAuthToken(null)

    assert.ok(url.startsWith('ws'), url)
    assert.ok(url.includes('ticket=TKT'), url)
    assert.ok(!url.includes('SESSION-TOKEN'), url)
    assert.ok(!url.includes('token=SESSION'), url)
  })

  it('puts a ticket in the export URL, alongside the filters', async () => {
    setAuthToken('SESSION-TOKEN')
    stubFetch(ticketResponse())
    const url = await exportUrl({ type: 'Ventricular' })
    setAuthToken(null)

    assert.ok(url.startsWith(`${API_BASE}/api/export.csv?`), url)
    assert.ok(url.includes('ticket=TKT'), url)
    assert.ok(url.includes('type=Ventricular'), url)
    assert.ok(!url.includes('SESSION-TOKEN'), url)
  })

  it('puts a ticket in the report URL', async () => {
    setAuthToken('SESSION-TOKEN')
    stubFetch(ticketResponse())
    const url = await reportUrl()
    setAuthToken(null)

    assert.ok(url.includes('ticket=TKT'), url)
    assert.ok(!url.includes('SESSION-TOKEN'), url)
  })

  it('signs out when the session is no longer good', async () => {
    let signedOut = false
    setAuthErrorHandler(() => {
      signedOut = true
    })
    stubFetch(stubResponse({ status: 401 }))
    await assert.rejects(fetchTicket(), { message: 'UNAUTHORIZED' })
    setAuthErrorHandler(null)
    assert.equal(signedOut, true)
  })

  it('reports other failures without signing out', async () => {
    let signedOut = false
    setAuthErrorHandler(() => {
      signedOut = true
    })
    stubFetch(stubResponse({ status: 503 }))
    await assert.rejects(fetchTicket(), { message: 'ticket -> 503' })
    setAuthErrorHandler(null)
    assert.equal(signedOut, false)
  })
})
