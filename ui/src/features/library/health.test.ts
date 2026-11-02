import { beforeEach, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { brokenVideos, forgetBroken, markBroken } from './broken'
import { healthGroups } from './health'

const t = (id: number, ids: LibraryTrack['ids'], artist = 'Daft Punk', album: string | null = 'Discovery'): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album, durationMs: null, isrc: null, ids })

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage
})

it('sorts the library into what needs a hand', () => {
  const tracks = [t(1, { youtube: 'aaaaaaaaaaa' }), t(2, { youtube: 'bbbbbbbbbbb' }), t(3, { local: 'C:/a.mp3' }), t(4, { local: 'C:/b.mp3' }, 'Unknown artist'), t(5, { local: 'C:/c.mp3' }, 'Air', null), t(6, { youtube: 'ccccccccccc' }, 'Air', null)]
  const g = healthGroups(tracks, [3, 9], new Set(['bbbbbbbbbbb']))
  expect(g.broken.map((x) => x.id)).toEqual([2])
  expect(g.cover.map((x) => x.id)).toEqual([3])
  // Streams' albums are the service's to give: local files only.
  expect(g.info.map((x) => x.id)).toEqual([4, 5])
})

it('keeps each unplayable video once, newest last, and forgets them', () => {
  markBroken('aaaaaaaaaaa', 'Video unavailable')
  markBroken('bbbbbbbbbbb', 'This video is private')
  markBroken('aaaaaaaaaaa', 'Video unavailable')
  expect(brokenVideos().map((b) => b.video)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
  forgetBroken(['bbbbbbbbbbb'])
  expect(brokenVideos().map((b) => [b.video, b.why])).toEqual([['aaaaaaaaaaa', 'Video unavailable']])
  localStorage.setItem('legato-broken-videos', '{bad')
  expect(brokenVideos()).toEqual([])
})
