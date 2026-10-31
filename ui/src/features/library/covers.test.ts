import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { coverTracks } from './covers'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string, s: string) => `http://${s}.localhost/${encodeURIComponent(p)}`, invoke: vi.fn() }))

const t = (id: number, title: string, art?: string): LibraryTrack => ({ id, added: id, addedAt: null, title, artist: 'A', album: null, durationMs: null, isrc: null, ids: {}, art })
const byId = new Map([t(1, 'b', 'https://x/1'), t(2, 'a', 'https://x/2'), t(3, 'c'), t(4, 'd', 'https://x/1'), t(5, 'e', 'https://x/5')].map((x) => [x.id, x]))

describe('coverTracks', () => {
  it('playlist order, songs without art or with the same art skipped', () => {
    expect(coverTracks([1, 3, 4, 2, 5], byId, 'playlist', 4).map((x) => x.id)).toEqual([1, 2, 5])
  })

  it('library sort when picked', () => {
    expect(coverTracks([1, 2, 5], byId, 'title', 1).map((x) => x.id)).toEqual([2])
    expect(coverTracks([1, 2, 5], byId, 'recent', 2).map((x) => x.id)).toEqual([5, 2])
  })

  it('unknown ids or no playlist: nothing', () => {
    expect(coverTracks([99], byId, 'playlist', 1)).toEqual([])
    expect(coverTracks(undefined, byId, 'playlist', 4)).toEqual([])
  })
})
