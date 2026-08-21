# Heartbeat — ECG Monitoring Frontend

A React + Vite single-page dashboard for viewing heart-rhythm data: a live ECG-style
waveform, per-beat classification with confidence, plain-language alerts, HRV and
trend charts, a filterable reading history, and account/data management.

The app is the **frontend only**. It talks to a separate Heartbeat backend over REST
and a WebSocket (see [Backend contract](#backend-contract)). With no backend running
the UI still loads, shows an `Offline · demo` pill, and animates a synthetic waveform
so the layout can be worked on without a server.

> Educational / research project. **Not a medical device**, and nothing it displays is
> a diagnosis.

---

## Repository layout

The Git repository root is a thin wrapper; the whole application lives in the
`heartbeat-frontend/` subdirectory. All npm commands are run from there.

```text
.
├── README.md                     ← you are here
└── heartbeat-frontend/           ← the Vite app (npm root)
    ├── .env.example              backend URL configuration template
    ├── eslint.config.js          ESLint 10 flat config
    ├── index.html                HTML entry; loads Space Grotesk + IBM Plex Mono
    ├── package.json              deps and scripts
    ├── vite.config.js            Vite + React plugin + React Compiler (Babel preset)
    ├── public/
    │   ├── favicon.svg           tab icon (referenced from index.html)
    │   └── icons.svg             unused sprite left from earlier iterations
    └── src/
        ├── main.jsx              React root, StrictMode mount, top-level boundary
        ├── App.jsx               all UI: login, dashboard, trends, history, account
        ├── api.js                REST client, auth token, WebSocket URL
        ├── alerts.js             pure alert-evaluation logic (no React)
        ├── alerts.test.js        alert-engine test suite (node:test)
        ├── ErrorBoundary.jsx     catches render errors so a panel fails, not the page
        ├── index.css             theme tokens + reset
        ├── App.css               component styling
        └── assets/               hero.png, react.svg, vite.svg (currently unreferenced)
```

### File-by-file

| File | Lines | What it holds |
| --- | ---: | --- |
| `src/App.jsx` | ~1033 | `LoginScreen`, `TrendsView`, `AccountView`, `Dashboard`, and the top-level `App` that chooses between login and dashboard based on a persisted session. |
| `src/api.js` | ~111 | `API_BASE` / `wsUrl()` derivation, in-memory bearer token, 401 handling, and one thin function per backend endpoint. |
| `src/alerts.js` | ~73 | `evaluateAlert()`, the tunable `ALERT_THRESHOLDS`, and `ALERT_RANK`. Pure functions, framework-free, unit-testable, and portable to the backend later. |
| `src/alerts.test.js` | ~242 | 30 cases over `evaluateAlert()` — levels, precedence, threshold boundaries, window bounds, and the "a confident normal beat is never urgent" invariant. |
| `src/ErrorBoundary.jsx` | ~35 | Class-component boundary. Returns children untouched when healthy, so it adds no DOM and no layout change. |
| `src/index.css` | ~82 | CSS custom properties: dark clinical surfaces, semantic alert colors, ECG trace green, fonts, radius, shadow. |
| `src/App.css` | ~816 | ~125 component classes — nav, alert banner, panels, metric cards, charts, tables, filters, forms. |

---

## Features

### Live monitor (`Monitor` tab)

- Opens a WebSocket to `${API_BASE}/ws?token=…` and listens for
  `{ type: "beat", data, samples }` frames; on close it retries every 2 seconds, except
  after an auth rejection (close code `1008`/`4401`), which signs the user out.
- The server is expected to authenticate the socket and stream only that user's beats.
  The client additionally drops beats whose `user_id` isn't the signed-in user, as
  defence in depth.
- Each beat updates the latest reading, prepends to the history table, feeds an
  unfiltered 25-beat window used for alert evaluation, and increments the local stat
  counters optimistically. The table holds 200 rows plus whatever the user has paged in,
  up to a 2000-row ceiling.
- The connection pill shows `Live` / `Connecting` / `Offline · demo`. A separate signal
  readout distinguishes `Streaming` from `Waiting for data` — if no beat arrives for
  10 seconds (`STREAM_IDLE_MS`) the label stops claiming a live feed.
- Large readouts for current classification, BPM, and confidence percentage.
- When the socket is not live, a sine-composite waveform generator ticks every 100 ms
  so the trace is never a dead line during development.

### Alerts

`src/alerts.js` maps a beat plus recent history onto one of five levels:

| Level | Meaning |
| --- | --- |
| `red` | Urgent — review now |
| `amber` | Caution — keep watching |
| `green` | Normal |
| `uncertain` | Low confidence or unclassified — explicitly not a diagnosis |
| `none` | No data yet |

Evaluation order:

1. **Uncertain first** — an `Unclassified` beat, or confidence below `minConfidence`
   (0.6), short-circuits to `uncertain`.
2. **Escalation only when the current beat is itself abnormal** (`Ventricular`,
   `Supraventricular`, `Fusion`). A confident ventricular beat (≥ `vConfidenceRed`,
   0.7), a run of 3+ ventricular beats in the 10-beat window, or an abnormal beat
   alongside a `TACHY`/`BRADY` flag yields `red`; any other abnormal beat is `amber`.
   A confident *normal* beat can never read as urgent because of older beats.
3. **Normal beat** — still `amber` if 2+ abnormal beats sit in the recent window or an
   `IRREG` flag is present; otherwise `green`.

Thresholds live in the exported `ALERT_THRESHOLDS` object, so the behavior is tunable in
one place. If the backend supplies its own `alert_level` (and optional `alert_detail`)
on a reading, the UI trusts that and skips local evaluation.

### Trends tab

Polls `/api/trends?points=60` and `/api/strip?count=8` every 5 seconds while the tab is
open, and renders:

- **HRV metric cards** — mean BPM, RMSSD (beat-to-beat variability, ms), and SDNN
  (overall variability, ms), each with a hover/focus `i` badge carrying a plain-language
  explanation.
- **ECG strip** — a line chart of the raw samples behind the last N beats.
- **Alert distribution** — counts of red / amber / green / uncertain across all readings.
- **Heart-rate line chart** over the recent beat window.
- **Beats-by-type bar chart**, each bar colored by class (green normal, red ventricular,
  amber supraventricular/fusion, grey unclassified).
- **Legend** describing what each beat class means in non-clinical language.
- **Download PDF report** button linking to the backend's report endpoint.

### History tab

- Table of past readings: timestamp, class, confidence percentage, and a colored status
  dot with its alert label.
- Filters — beat type, minimum confidence (any / ≥60% / ≥80% / ≥90%), from/to dates, and
  an abnormal-only checkbox.
- Every filter is sent to the server — type, min confidence, abnormal-only, and date
  bounds converted to ISO `since`/`until` — so the table and the CSV export are built
  from the same query. A second client-side pass applies the same predicates to beats
  that arrive live over the socket, which bypass the server query.
- **Export CSV** builds a download URL carrying those same filters plus the session token.
- **Load older** pages in 50 more rows by asking for readings older than the oldest row
  held, rather than by offset — offsets shift as new beats are recorded, which
  duplicated and skipped rows. Overlapping boundary rows are de-duplicated by id.
- Loading, empty, filtered-empty, and failed states are distinguished, with a retry.

### Account tab

- Account summary: name, creation date, reading count.
- Change password.
- Danger zone: delete all readings, or delete the account entirely — both behind a
  `window.confirm` prompt; account deletion signs the user out.

### Authentication

- One combined sign-in / sign-up screen: an unknown name creates an account whose
  password is whatever was typed. The form is prefilled with the demo account
  (`Demo User` / `demo`).
- On success the `{ id, name, token }` record is stored in `localStorage` under
  `heartbeat_user`, and the token is held in a module-level variable in `api.js` and
  attached as an `Authorization: Bearer` header.
- Any `401` from the API triggers the registered auth-error handler, which clears the
  token and local storage and returns to the login screen — so a backend restart or
  database reset doesn't leave a stale session wedged.
- CSV and PDF downloads are plain `<a href>` links, so the token rides along as a
  `?token=` query parameter instead of a header.

This is deliberately simple project-grade auth, not production security.

---

## Tech stack

| Piece | Version | Notes |
| --- | --- | --- |
| React | 19.2.6 | Function components and hooks only |
| React Compiler | babel-plugin-react-compiler 1.0 | Enabled via `@rolldown/plugin-babel` in `vite.config.js` |
| Vite | 8.x | Dev server, build, preview |
| Recharts | 3.8.1 | Line and bar charts in responsive containers |
| ESLint | 10.x flat config | `@eslint/js` recommended + react-hooks + react-refresh |
| Tests | `node:test` | Built into Node; no test framework is installed |

Function components with `React.Component` used only for the error boundary. No
TypeScript, no CI configuration, and no state-management library — state is local
`useState`/`useEffect` inside `App.jsx`.

---

## Getting started

Prerequisites: **Node.js 20.19+** and npm — Vite 8 and ESLint 10 both dropped Node 18, so
the older floor the previous README quoted will not install. A running Heartbeat backend
is needed for real data.

```bash
cd heartbeat-frontend
npm install
cp .env.example .env      # optional; only needed to point at a non-default backend
npm run dev               # http://localhost:5173
```

### Scripts

| Command | Effect |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run lint` | ESLint over the project |
| `npm test` | Alert-engine test suite (`node --test`, no dependencies) |

### Configuration

A single environment variable, read at build time:

```env
VITE_API_URL=http://localhost:8000
```

`api.js` strips a trailing slash, falls back to `http://localhost:8000` when the
variable is unset, and derives the WebSocket URL by swapping the `http` prefix for `ws`
and appending `/ws`. Because Vite inlines env vars at build time, changing it requires a
dev-server restart or a rebuild.

---

## Backend contract

Everything the frontend calls, all defined in `src/api.js`:

| Method | Path | Used for |
| --- | --- | --- |
| `POST` | `/api/login` | Sign in or sign up; returns `{ id, name, token }`, `401` on wrong password |
| `POST` | `/api/logout` | Best-effort session teardown (failures ignored) |
| `GET` | `/api/history?limit&until&since&type&abnormal_only&min_confidence` | Reading history. `until` doubles as the paging cursor; `offset` is no longer used. |
| `GET` | `/api/stats` | Total beats, abnormal beats, counts by class |
| `GET` | `/api/latest` | Most recent reading |
| `GET` | `/api/trends?points` | Heart-rate series, class distribution, alert distribution |
| `GET` | `/api/strip?count` | Raw ECG samples plus HRV values for the last N beats |
| `GET` | `/api/account` | Name, `created_at`, `reading_count` |
| `POST` | `/api/change-password` | `{ current_password, new_password }` |
| `DELETE` | `/api/account/readings` | Delete all readings for the user |
| `DELETE` | `/api/account` | Delete the account |
| `GET` | `/api/export.csv?…&token` | Filtered CSV download |
| `GET` | `/api/report.pdf?token` | PDF report download |
| `WS` | `/ws?token=…` | Authenticated beat stream: `{ type: "beat", data: <reading>, samples?: number[] }`. The server must scope the stream to the token's user, and may close with `1008`/`4401` to reject it. |

### Reading shape

The UI reads these fields off a reading:

```jsonc
{
  "id": 1234,
  "user_id": 1,
  "recorded_at": "2026-08-18T20:13:00Z",
  "bpm": 72,
  "classification": "Normal",   // Normal | Supraventricular | Ventricular | Fusion | Unclassified
  "confidence": 0.94,           // 0..1
  "is_abnormal": false,
  "flags": ["TACHY", "BRADY", "IRREG"],  // optional, used by the alert rules
  "alert_level": "green",       // optional; overrides local evaluation
  "alert_detail": "…"           // optional, shown under the alert label
}
```

Trends payload: `{ points, heart_rate: [{ bpm }], class_distribution: { [class]: n },
alert_distribution: { red, amber, green, uncertain } }`.
Strip payload: `{ beats, samples: number[], hrv: { mean_bpm, rmssd, sdnn } }`.

---

## Design

Dark, instrument-panel styling defined entirely with CSS custom properties in
`index.css` — near-black layered surfaces, a green ECG trace (`--trace: #36d399`), a blue
accent, and semantic red/amber/green alert colors with matching translucent backgrounds.
Type is Space Grotesk for UI and IBM Plex Mono for numeric readouts and timestamps,
loaded from Google Fonts in `index.html`. `color-scheme: dark` is fixed; there is no
light theme.

---

## Testing

```bash
npm test
```

`src/alerts.test.js` covers the alert engine — 30 cases over the five levels, the
precedence of `uncertain` over escalation, threshold boundaries, window bounds,
caller-supplied thresholds, and the invariant that a confident normal beat is never
reported as urgent. It uses `node:test`, so it runs on a bare checkout with nothing
installed. The React components have no tests.

## Known limitations

- **Optimistic stats.** Live beats increment local counters without re-fetching
  `/api/stats`, so totals can drift from the server until reload.
- **Token in query strings.** The WebSocket upgrade and the CSV/PDF downloads put the
  session token in the URL, where it can land in server logs or browser history. The
  browser WebSocket API cannot send headers; the downloads could use a `blob:` fetch or
  a short-lived one-time token instead.
- **Live beats are filtered client-side.** Rows fetched from the server honour every
  filter, but beats arriving over the socket are matched against the filters in the
  browser, so the counts shown reflect what has been loaded rather than a server-side
  total.
- **Reconnects have no backoff.** The socket retries every 2 seconds indefinitely,
  except after an auth rejection.
- **Trends poll while hidden.** The 5-second poll keeps running in a background tab.
- **`ALERT_RANK` is exported but unused** by the UI; it exists for sorting or
  "highest alert in the last hour" style features.
- **Unreferenced assets** remain in `public/icons.svg` and `src/assets/`.
- **`App.jsx` is ~980 lines** holding four screens plus socket, polling and filter
  state; it is the obvious next refactor.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Pill stuck on `Offline · demo` | Is the backend running? Is `VITE_API_URL` correct? Does `${API_BASE}/ws` accept WebSocket upgrades? Restart `npm run dev` after editing `.env`. |
| Signed out immediately after login | The backend returned `401` on a follow-up call — usually a reset database or a token the server no longer recognizes. |
| Waveform animates but no beats appear | That trace is the offline simulation. Confirm the socket is open and that beats carry the signed-in user's `user_id`. |
| Empty history and zeroed stats | Signed in as a user with no readings, or no ingest feed is running against the backend. |
| Requests blocked in the browser console | Backend CORS must allow the dev origin (`http://localhost:5173`). |

---

## License

No license file is present. Contact the repository owner before redistributing or
deploying.
