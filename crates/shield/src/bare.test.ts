import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const src = readFileSync(new URL('./bare.js', import.meta.url), 'utf8')
const g = globalThis as Record<string, unknown>

/** Run script in a fake frame at `url`; returns the CSS it adopted. */
function inject(url: string): string[] {
  const { hostname, pathname, search } = new URL(url)
  const doc = { adoptedStyleSheets: [] as { css: string }[] }
  g.location = { hostname, pathname, search }
  g.document = doc
  g.CSSStyleSheet = class {
    css = ''
    replaceSync(css: string) {
      this.css = css
    }
  }
  try {
    new Function(src)()
    return doc.adoptedStyleSheets.map((s) => s.css)
  } finally {
    delete g.location
    delete g.document
    delete g.CSSStyleSheet
  }
}

it('hides YouTube overlays in bare embeds', () => {
  const [css] = inject('https://www.youtube.com/embed/abc?enablejsapi=1&controls=0&rel=0')
  expect(css).toContain('.ytp-chrome-top')
  expect(css).toContain('.ytp-pause-overlay')
  expect(css).toMatch(/\{display:none!important\}$/)
})

it('leaves embeds with controls, watch pages and other sites alone', () => {
  expect(inject('https://www.youtube.com/embed/abc?enablejsapi=1')).toEqual([])
  expect(inject('https://www.youtube.com/watch?v=abc&controls=0')).toEqual([])
  expect(inject('https://tauri.localhost/embed/x?controls=0')).toEqual([])
})
