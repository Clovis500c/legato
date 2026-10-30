import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { startDiagnostics } from './app/diagnostics'
import { applyCached, languageReady } from './app/settings'

// First: what goes wrong from here on is kept in the local diagnostics log.
startDiagnostics()
applyCached()
// The interface's language before the first render (its table loads on demand): no flash of English.
await languageReady()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
