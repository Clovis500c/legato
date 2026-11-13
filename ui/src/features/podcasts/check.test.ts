import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastFeed } from '../../shared/api'

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) })
const { due, EVERY_MS, newIn } = await import('./check')

const feed = (ids: string[]): PodcastFeed => ({ url: 'u', title: 't', author: '', image: '', episodes: ids.map((id) => ({ id, title: id, url: `https://x/${id}.mp3`, durationMs: null, published: '' })) })

describe('podcast check', () => {
  beforeEach(() => Object.keys(store).forEach((k) => delete store[k]))
  it('asks again after six hours, or when the clock went back', () => {
    expect(due(0, 1000)).toBe(true)
    expect(due(1000, 1000 + EVERY_MS - 1)).toBe(false)
    expect(due(1000, 1000 + EVERY_MS)).toBe(true)
    expect(due(5000, 1000)).toBe(true)
  })
  it('counts what the page has not shown, never for a show never opened', () => {
    expect(newIn(feed(['a', 'b']))).toBe(0)
    store['legato.podcasts'] = JSON.stringify({ played: [], seen: { u: ['a'] } })
    expect(newIn(feed(['c', 'b', 'a']))).toBe(2)
  })
})
