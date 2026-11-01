import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

const src = readFileSync(new URL('./refused.js', import.meta.url), 'utf8')
const g = globalThis as Record<string, unknown>
const saved = { location: g.location, parent: g.parent, PerformanceObserver: g.PerformanceObserver }
afterEach(() => void Object.assign(g, saved))

type Seen = (list: { getEntries: () => { name: string; responseStatus: number }[] }) => void

/** Run the script in a fake frame at `url`: what it posts to its parent, and resource timings fed to it. */
function inject(url: string) {
  const { hostname, pathname, search } = new URL(url)
  const posted: [unknown, string][] = []
  let seen: Seen | undefined
  g.location = { hostname, pathname, search }
  g.parent = { postMessage: (m: string, origin: string) => posted.push([JSON.parse(m), origin]) }
  g.PerformanceObserver = class {
    constructor(cb: Seen) {
      seen = cb
    }
    observe() {}
  }
  new Function(src)()
  return { posted, answer: (name: string, responseStatus: number) => seen?.({ getEntries: () => [{ name, responseStatus }] }) }
}

const APP = 'http://tauri.localhost'
const EMBED = `https://www.youtube.com/embed/abc?enablejsapi=1&controls=0&origin=${encodeURIComponent(APP)}`

it('tells the app that loaded the embed when Google refuses the player request', () => {
  const { posted, answer } = inject(EMBED)
  answer('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', 403)
  answer('https://www.youtube.com/youtubei/v1/player', 429)
  expect(posted).toEqual([
    [{ musicApp: 'refused', status: 403 }, APP],
    [{ musicApp: 'refused', status: 429 }, APP],
  ])
})

it('stays quiet for answers, other requests and other pages', () => {
  const { posted, answer } = inject(EMBED)
  answer('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', 200)
  answer('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', 403)
  answer('https://www.youtube.com/youtubei/v1/player/heartbeat?alt=json', 403)
  answer('https://www.youtube.com/ptracking?html5=1', 403)
  expect(posted).toEqual([])
  // Watch page, an embed with no app named, a page that isn't YouTube's.
  for (const url of ['https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/embed/abc', `https://evil.example/embed/abc?origin=${APP}`]) {
    const other = inject(url)
    other.answer('https://www.youtube.com/youtubei/v1/player', 403)
    expect(other.posted).toEqual([])
  }
})
