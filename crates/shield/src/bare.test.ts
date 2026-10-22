import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const src = readFileSync(new URL('./bare.js', import.meta.url), 'utf8')
const g = globalThis as Record<string, unknown>

interface FakeDoc {
  adoptedStyleSheets: { css: string }[]
  head: { children: { textContent: string; isConnected: boolean }[]; appendChild: (el: { isConnected: boolean }) => void } | null
  documentElement: object
}

/** Run script in a fake frame at `url`; returns the fake document and the observer's callback. */
function inject(url: string) {
  const { hostname, pathname, search } = new URL(url)
  const head = {
    children: [] as { textContent: string; isConnected: boolean }[],
    appendChild(el: { textContent: string; isConnected: boolean }) {
      // Like the DOM: appending an element again moves it, no copy.
      el.isConnected = true
      if (!this.children.includes(el)) this.children.push(el)
    },
  }
  const doc: FakeDoc = { adoptedStyleSheets: [], head, documentElement: {} }
  let observer: (() => void) | undefined
  g.location = { hostname, pathname, search }
  g.document = { ...doc, createElement: () => ({ textContent: '', isConnected: false }) }
  g.CSSStyleSheet = class {
    css = ''
    replaceSync(css: string) {
      this.css = css
    }
  }
  g.MutationObserver = class {
    constructor(cb: () => void) {
      observer = cb
    }
    observe() {}
  }
  try {
    new Function(src)()
    return { doc: g.document as FakeDoc, mutate: () => observer?.() }
  } finally {
    delete g.location
    delete g.CSSStyleSheet
    delete g.MutationObserver
  }
}

it('hides YouTube overlays in bare embeds, twice over', () => {
  const { doc } = inject('https://www.youtube.com/embed/abc?enablejsapi=1&controls=0&rel=0')
  const [css] = doc.adoptedStyleSheets.map((s) => s.css)
  for (const overlay of ['.ytp-chrome-top', '.ytp-pause-overlay', '.ytp-cued-thumbnail-overlay', '.ytp-unmute', '.ytp-upnext', '.ytp-error', '.ytp-title', '.ytPlayerControlsContainerHost', '.ytmVideoCoverHost']) expect(css).toContain(overlay)
  expect(css).toMatch(/\{display:none!important\}$/)
  expect(doc.head!.children[0].textContent).toBe(css)
  delete g.document
})

it('puts its sheet back when the page replaces the adopted sheets', () => {
  const { doc, mutate } = inject('https://www.youtube.com/embed/abc?controls=0')
  doc.adoptedStyleSheets = []
  doc.head!.children[0].isConnected = false
  mutate()
  expect(doc.adoptedStyleSheets).toHaveLength(1)
  expect(doc.head!.children.filter((c) => c.isConnected)).toHaveLength(1)
  delete g.document
})

it('leaves embeds with controls, watch pages and other sites alone', () => {
  for (const url of ['https://www.youtube.com/embed/abc?enablejsapi=1', 'https://www.youtube.com/watch?v=abc&controls=0', 'https://tauri.localhost/embed/x?controls=0']) {
    const { doc } = inject(url)
    expect(doc.adoptedStyleSheets).toEqual([])
    expect(doc.head!.children).toEqual([])
    delete g.document
  }
})
