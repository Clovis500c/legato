import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type LibraryPlaylist, type LibraryTrack } from '../shared/api'
import { playlistSongs, useStore } from './store'

const list = (id: number, custom: boolean, sourceId: string): LibraryPlaylist => ({ id, source: custom ? 'local' : 'youtube', sourceId, name: 'Liked Music', trackCount: 2, custom, newestFirst: !custom, orderManual: false })
const song = (id: number): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist: 'Artist', album: null, durationMs: null, isrc: null, ids: { youtube: `video${id}` } })

describe('library read with both Liked Music lists', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows one, with yours folded in; the like button still sees both', async () => {
    const offline = { connected: false } as Awaited<ReturnType<typeof api.sourcesStatus>>['youtube']
    vi.spyOn(api, 'sourcesStatus').mockResolvedValue({ spotify: offline, youtube: offline })
    vi.spyOn(api, 'library').mockResolvedValue({ tracks: [1, 2, 3].map(song), playlists: [list(1, false, 'LM'), list(2, true, 'custom-a')], orders: { 1: [1, 2], 2: [3] } })
    vi.spyOn(api, 'playStats').mockResolvedValue({})
    vi.spyOn(api, 'notFound').mockResolvedValue([])
    vi.spyOn(api, 'playlistTracks').mockImplementation(async (id) => (id === 1 ? [song(1), song(2)] : [song(3)]))
    await useStore.getState().refresh()
    const s = useStore.getState()
    expect(s.playlists.map((p) => [p.id, p.trackCount])).toEqual([[1, 3]])
    expect(s.orders[1]).toEqual([3, 1, 2])
    expect(s.raw.playlists).toHaveLength(2)
    expect((await playlistSongs(1)).map((t) => t.id)).toEqual([3, 1, 2])
    // An old link to yours opens the one shown.
    useStore.getState().go({ name: 'playlist', id: 2 })
    expect(useStore.getState().view).toEqual({ name: 'playlist', id: 1 })
  })
})
