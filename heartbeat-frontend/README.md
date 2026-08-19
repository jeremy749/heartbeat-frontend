# Heartbeat Frontend — app directory

This is the Vite app itself. Full documentation (features, alert rules, backend
contract, data shapes, known limitations) lives in the [root README](../README.md).

## Quickstart

```bash
npm install
cp .env.example .env      # optional; defaults to http://localhost:8000
npm run dev               # http://localhost:5173
```

| Command | Effect |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run lint` | ESLint over the project |

## Source map

- `src/App.jsx` — login screen, dashboard, trends, history, and account views
- `src/api.js` — REST client, bearer token handling, WebSocket URL
- `src/alerts.js` — pure alert-evaluation logic and thresholds
- `src/index.css` — theme tokens; `src/App.css` — component styling

Educational / research project. Not a medical device and not a diagnosis.
