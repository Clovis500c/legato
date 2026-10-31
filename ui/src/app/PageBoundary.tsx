import { Component, type ErrorInfo, type ReactNode, Suspense } from 'react'
import { Button } from '../shared/ui/Button'
import { describe, frames, report } from '../shared/diag'
import { tr } from '../shared/i18n/i18n'

/**
 * Around a lazy page: waiting (Suspense) and a page chunk that failed to load. Only this spot shows the failure, the
 * sidebar and the player carry on. Try again asks for the chunk anew. `fallback` replaces the card where a card would
 * not fit (null = nothing is drawn). A page that fails while drawing is still the root ErrorBoundary's.
 */
export class PageBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const said = describe(error, 'A page failed to load')
    report('warn', 'ui', said.message + frames(info.componentStack), said.detail)
  }

  // The page draws again and, its last load having failed, asks for the chunk anew (pages.ts).
  retry = () => this.setState({ failed: false })

  render() {
    if (!this.state.failed) return <Suspense>{this.props.children}</Suspense>
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="text-[0.8125rem] text-ink-2">{tr('Couldn’t load this page.')}</p>
        <Button variant="ghost" onClick={this.retry}>
          {tr('Try again')}
        </Button>
      </div>
    )
  }
}
