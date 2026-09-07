// charts.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Every Recharts-backed chart in the app, in one module.
//
// Recharts is by far the largest dependency - most of the bundle. Keeping it
// behind this single module means it can be loaded lazily: the shell, the alert
// banner and the numeric readouts paint immediately, and the traces arrive a
// moment later. Nothing here holds state; they are presentational.
//
// Import this module only through the lazy wrappers in LazyChart.jsx, or the
// code splitting is defeated.
// ─────────────────────────────────────────────────────────────────────────────

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

const TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
}

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 12 }
const MARGIN = { top: 12, right: 8, left: 0, bottom: 4 }

// An ECG trace in millivolts. Used for both the live monitor and the stored
// strip on the trends tab, which differ only in size and cursor.
export function EcgChart({ data, height = 200, strokeWidth = 1.5, cursor = false, label }) {
  return (
    <div className="waveform" role="img" aria-label={label || 'ECG waveform'}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="x" tick={false} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} tick={false} axisLine={false} tickLine={false} width={8} />
          <Tooltip
            cursor={cursor ? { stroke: 'var(--trace)', strokeOpacity: 0.3 } : undefined}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${Number(value).toFixed(2)} mV`, 'ECG']}
            labelFormatter={() => ''}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--trace)"
            strokeWidth={strokeWidth}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HeartRateChart({ data, label }) {
  return (
    <div className="waveform" role="img" aria-label={label || 'Heart rate over recent beats'}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="i" tick={false} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} width={32} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${Math.round(value)} bpm`, 'Heart rate']}
            labelFormatter={() => ''}
          />
          <Line
            type="monotone"
            dataKey="bpm"
            stroke="var(--trace)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ClassDistributionChart({ data, colors, label }) {
  return (
    <div className="waveform" role="img" aria-label={label || 'Beats by classification'}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={MARGIN}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--text-dim)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis width={32} tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={colors[entry.name] || 'var(--accent)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
