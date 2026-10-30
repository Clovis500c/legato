import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../shared/ui/Button'
import { copyDiagnostics, describe, frames, report } from '../shared/diag'
import { tr } from '../shared/i18n/i18n'

/** The last net: an error while drawing leaves a calm page with a way out, not a blank window. Kept in the diagnostics log. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; copied?: boolean }> {
  state: { failed: boolean; copied?: boolean } = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const said = describe(error, 'The interface crashed')
    report('error', 'ui', said.message + frames(info.componentStack), said.detail)
  }

  copy = () => void copyDiagnostics(false).then((copied) => this.setState({ copied }))

  render() {
    if (!this.state.failed) return this.props.children
    const { copied } = this.state
    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-bg p-6 text-ink">
        <div className="flex max-w-md flex-col gap-4 rounded-xl border border-line bg-raised p-6">
          <h1 className="text-lg font-bold tracking-[-0.02em]">{tr('Something went wrong')}</h1>
          <p className="text-[0.8125rem] text-ink-2">{tr('The app hit an unexpected error. Your library isn’t touched: reload to carry on. If it keeps happening, copy the diagnostics into a bug report.')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => window.location.reload()}>{tr('Reload')}</Button>
            <Button variant="ghost" onClick={this.copy}>
              {tr('Copy diagnostics')}
            </Button>
            {copied !== undefined && <span className="text-xs text-ink-2">{copied ? tr('Copied to clipboard') : tr('Couldn’t copy the diagnostics')}</span>}
          </div>
        </div>
      </div>
    )
  }
}
