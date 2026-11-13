import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack, SharedSong } from '../../shared/api'
import { playSharedSong, type PlayDeps } from './playShared'

const mine = { id: 7, title: 'Mine', artist: 'A', ids: {} } as unknown as LibraryTrack
const deps = (song: () => Promise<SharedSong>): PlayDeps & { played: LibraryTrack[][]; failed: unknown[] } => {
  const played: LibraryTrack[][] = []
  const failed: unknown[] = []
  return { song, library: () => [mine], play: (l) => played.push(l), fail: (e) => failed.push(e), played, failed }
}

describe('playSharedSong', () => {
  it('plays the library row of a song it already has', async () => {
    const d = deps(async () => ({ track: { title: 'Mine', artist: 'A', ids: {} } as never, libraryId: 7 }))
    expect(await playSharedSong('code', d)).toBe(true)
    expect(d.played).toEqual([[mine]])
  })

  it('plays a song that is not in the library with the sources it came with', async () => {
    const d = deps(async () => ({ track: { title: 'New', artist: 'B', album: null, durationMs: null, isrc: null, ids: { youtube: 'abcdefghijk' }, art: null, musicness: null, explicit: false } as never, libraryId: null }))
    expect(await playSharedSong('code', d)).toBe(true)
    expect(d.played).toHaveLength(1)
    expect(d.played[0]).toHaveLength(1)
    expect([d.played[0][0].title, d.played[0][0].ids.youtube]).toEqual(['New', 'abcdefghijk'])
  })

  it('says why a song could not be found and plays nothing', async () => {
    const d = deps(() => Promise.reject(new Error('“Gone” wasn’t found on YouTube or Apple Music')))
    expect(await playSharedSong('code', d)).toBe(false)
    expect(d.played).toEqual([])
    expect(String(d.failed[0])).toContain('Gone')
    vi.restoreAllMocks()
  })
})
