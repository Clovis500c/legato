import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

it('keeps a drag strip and a Close button in the fallback: the frameless window has no other', () => {
  const boundary = new ErrorBoundary({ children: null })
  expect(boundary.render()).toBeNull()
  boundary.state = { failed: true }
  const html = renderToStaticMarkup(createElement('div', null, boundary.render()))
  expect(html).toMatch(/<div data-tauri-drag-region="[^"]*" class="[^"]*fixed[^"]*top-0/)
  expect(html).toMatch(/<button [^>]*aria-label="Close"/)
  expect(html).toContain('Reload')
  expect(html).toContain('Copy diagnostics')
})
