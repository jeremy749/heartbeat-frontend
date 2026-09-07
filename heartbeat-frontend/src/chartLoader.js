// The single dynamic import of charts.jsx, so the chart chunk is defined in one
// place. Kept apart from LazyChart.jsx because a module that exports both
// components and plain functions breaks fast refresh.

export const importCharts = () => import('./charts.jsx')

// Warm the chunk without rendering anything.
export const preloadCharts = () => {
  importCharts()
}
