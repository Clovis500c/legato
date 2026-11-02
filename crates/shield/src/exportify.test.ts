import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

const src = readFileSync(new URL('./exportify.js', import.meta.url), 'utf8')
const g = globalThis as Record<string, unknown>
const saved = { location: g.location, window: g.window, top: g.top, chrome: g.chrome, document: g.document, sessionStorage: g.sessionStorage, MutationObserver: g.MutationObserver }
afterEach(() => {
  Object.assign(g, saved)
  vi.useRealTimers()
})

/** Exportify's page signed in, its Export All button there: what the script posts, and its progress bar to move. */
function inject() {
  vi.useFakeTimers()
  const posted: string[] = []
  const bar = { text: '', value: '0' }
  let changed: (() => void) | undefined
  const store = new Map<string, string>()
  g.location = { hostname: 'exportify.app', search: '?code=x' }
  g.window = g
  g.top = g
  g.chrome = { webview: { postMessage: (m: string) => posted.push(m) } }
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }
  g.MutationObserver = class {
    constructor(cb: () => void) {
      changed = cb
    }
    observe() {}
  }
  g.document = {
    documentElement: {},
    querySelector: (sel: string) =>
      sel.startsWith('th.export') ? { click() {} } : sel === '.progress-bar' && bar.text ? { textContent: ` ${bar.text} `, getAttribute: () => bar.value } : null,
  }
  new Function(src)()
  vi.advanceTimersByTime(500)
  return { posted, move: (text: string, value: string) => (Object.assign(bar, { text, value }), changed?.()) }
}

it('sends each line of the progress bar once, as the lists export', () => {
  const { posted, move } = inject()
  expect(posted).toEqual(['legato-exportify:ready', 'legato-exportify:busy'])
  move('Exporting Rock...', '0')
  move('Exporting Rock...', '0')
  // Two lists of one name: two lines.
  move('Exporting Rock...', '1')
  move('Exporting Cool Music 🎶...', '2')
  expect(posted.filter((m) => m.includes(':name:'))).toEqual([
    'legato-exportify:name:Exporting Rock...',
    'legato-exportify:name:Exporting Rock...',
    'legato-exportify:name:Exporting Cool Music 🎶...',
  ])
})
