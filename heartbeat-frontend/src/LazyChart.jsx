import { Suspense, lazy } from 'react'
import { importCharts } from './chartLoader.js'

// Recharts and the chart components load on demand. Until they arrive the panel
// keeps its height, so nothing below it jumps when the trace appears.
//
// All three point at the same module, so the chunk is fetched once and the
// other two resolve from cache.
const Ecg = lazy(() => importCharts().then((m) => ({ default: m.EcgChart })))
const HeartRate = lazy(() => importCharts().then((m) => ({ default: m.HeartRateChart })))
const ClassDistribution = lazy(() =>
  importCharts().then((m) => ({ default: m.ClassDistributionChart })),
)

const Placeholder = ({ height }) => (
  <div className="waveform chart-loading" style={{ height }} aria-hidden="true" />
)

export function EcgChart(props) {
  return (
    <Suspense fallback={<Placeholder height={props.height ?? 200} />}>
      <Ecg {...props} />
    </Suspense>
  )
}

export function HeartRateChart(props) {
  return (
    <Suspense fallback={<Placeholder height={240} />}>
      <HeartRate {...props} />
    </Suspense>
  )
}

export function ClassDistributionChart(props) {
  return (
    <Suspense fallback={<Placeholder height={240} />}>
      <ClassDistribution {...props} />
    </Suspense>
  )
}
