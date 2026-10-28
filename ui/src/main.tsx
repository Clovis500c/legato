import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './app/App'
import { applyCached, languageReady } from './app/settings'

applyCached()
// The interface's language before the first render (its table loads on demand): no flash of English.
await languageReady()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
