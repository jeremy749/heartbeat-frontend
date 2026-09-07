// Component tests for the charts. Run with `npm run test:ui` (or `npm test`).
//
// These exist for one reason above all: a synthetic trace must never be able to
// render like a real reading. That distinction is the most safety-relevant thing
// in the UI and it lives in markup and classes, so it needs a renderer to check
// - the pure-logic suites cannot see it.
//
// Recharts draws into a ResponsiveContainer that measures its parent, and jsdom
// reports every element as 0x0, so the SVG paths themselves are not asserted on.
// Everything these tests care about - the caption, the classes, the labels - is
// outside the chart surface.

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClassDistributionChart, EcgChart, HeartRateChart } from './charts.jsx'

const trace = Array.from({ length: 20 }, (_, x) => ({ x, value: Math.sin(x) }))

describe('EcgChart · real readings', () => {
  it('carries no demo caption', () => {
    render(<EcgChart data={trace} />)
    expect(screen.queryByText(/demo trace/i)).toBeNull()
  })

  it('is not marked as a demo', () => {
    const { container } = render(<EcgChart data={trace} />)
    const figure = container.querySelector('.waveform')
    expect(figure).not.toBeNull()
    expect(figure.className).not.toMatch(/waveform-demo/)
  })

  it('describes itself as a waveform for assistive tech', () => {
    render(<EcgChart data={trace} label="Live ECG waveform" />)
    expect(screen.getByRole('img', { name: 'Live ECG waveform' })).toBeTruthy()
  })

  it('falls back to a generic label', () => {
    render(<EcgChart data={trace} />)
    expect(screen.getByRole('img', { name: /ecg waveform/i })).toBeTruthy()
  })
})

describe('EcgChart · demo trace', () => {
  it('says so on the plot, not just in the corner of the screen', () => {
    render(<EcgChart data={trace} demo />)
    expect(screen.getByText(/demo trace — not your data/i)).toBeTruthy()
  })

  it('marks the container so the dashed, desaturated styling applies', () => {
    const { container } = render(<EcgChart data={trace} demo />)
    expect(container.querySelector('.waveform-demo')).not.toBeNull()
  })

  it('tells assistive tech it is not real data', () => {
    render(<EcgChart data={trace} demo label="Demo trace, not real data" />)
    expect(screen.getByRole('img', { name: /not real data/i })).toBeTruthy()
  })

  it('renders identically apart from the demo treatment', () => {
    // Guards against the fix being undone by a refactor that keeps the prop but
    // drops its effect: same data, and the only difference is the marking.
    const real = render(<EcgChart data={trace} />).container.innerHTML
    const demo = render(<EcgChart data={trace} demo />).container.innerHTML
    expect(demo).not.toEqual(real)
    expect(demo).toMatch(/waveform-demo/)
    expect(real).not.toMatch(/waveform-demo/)
  })
})

describe('HeartRateChart', () => {
  it('is labelled', () => {
    render(<HeartRateChart data={[{ i: 0, bpm: 70 }]} label="Heart rate over 60 beats" />)
    expect(screen.getByRole('img', { name: 'Heart rate over 60 beats' })).toBeTruthy()
  })
})

describe('ClassDistributionChart', () => {
  it('is labelled', () => {
    render(
      <ClassDistributionChart
        data={[{ name: 'Normal', count: 3 }]}
        colors={{ Normal: 'green' }}
        label="Beats by classification"
      />,
    )
    expect(screen.getByRole('img', { name: 'Beats by classification' })).toBeTruthy()
  })

  it('survives an empty distribution', () => {
    // The bar chart maps over its data to colour each cell; an account with no
    // readings hands it an empty array.
    expect(() =>
      render(<ClassDistributionChart data={[]} colors={{}} label="Empty" />),
    ).not.toThrow()
  })
})
