import { Component } from 'react'

// The charts render whatever shape the backend sends. One malformed payload
// should cost you a panel, not the whole dashboard - without a boundary, a
// throw inside Recharts unmounts the entire tree and leaves a blank page.
//
// A class component because React still has no hook equivalent for this.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info?.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className="boundary" role="alert">
        <h2 className="boundary-title">{this.props.title || 'Something went wrong'}</h2>
        <p className="boundary-detail">{error.message || 'This view failed to render.'}</p>
        <button type="button" className="retry-btn" onClick={this.reset}>
          Try again
        </button>
      </section>
    )
  }
}
