import { describe, report, reportError } from '../shared/diag'
import { useStore } from './store'

/**
 * Errors the interface meets, forwarded to the local diagnostics log (shared/diag.ts, nothing sent): uncaught errors,
 * unhandled promise rejections, and every error the interface shows in its alert (a failed command, a player failure:
 * errors.ts words the network ones in plain English). Started before the first render.
 */
export function startDiagnostics(): void {
  window.addEventListener('error', (e) => {
    // The browser's own noise: a resize observer that skipped a frame.
    if (/ResizeObserver loop/i.test(e.message)) return
    // Our own bundle: file name and place, no path.
    const where = e.filename ? ` at ${e.filename.split(/[/\\]/).pop()?.split('?')[0]}:${e.lineno}:${e.colno}` : ''
    const said = describe(e.error ?? e.message, 'Uncaught error')
    report('error', 'ui', said.message + where, said.detail)
  })
  window.addEventListener('unhandledrejection', (e) => reportError('ui', e.reason, 'Unhandled promise rejection', 'error'))
  useStore.subscribe((s, before) => {
    if (s.error && s.error !== before.error) reportError('ui', s.error, 'A command failed')
  })
}
