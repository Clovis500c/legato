import { describe, expect, it } from 'vitest'
import { SpotifyConnector } from './spotify'
import { fakeFetch, memoryStore, validTokens } from './testing'

const track = (id: string, name: string, artist: string, isrc?: string) => ({
  id,
  type: 'track',
  name,
  artists: [{ name: artist }],
  album: { name: 'Album' },
  duration_ms: 200_000,
  external_ids: isrc ? { isrc } : {},
})

const connector = (routes: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(routes)
  return { f, spotify: new SpotifyConnector('CID', memoryStore({ spotify: validTokens }), () => {}, f) }
}

describe('SpotifyConnector', () => {
  it('liste seulement les playlists possédées ou collaboratives, avec pagination', async () => {
    const { spotify, f } = connector({
      'GET api.spotify.com/v1/me': { id: 'me' },
      'GET api.spotify.com/v1/me/playlists': (url: URL) =>
        url.searchParams.get('offset')
          ? { items: [{ id: 'c', name: 'Collab', owner: { id: 'bob' }, collaborative: true }], next: null }
          : {
              items: [
                { id: 'a', name: 'Mine', owner: { id: 'me' }, collaborative: false },
                { id: 'b', name: 'Followed', owner: { id: 'bob' }, collaborative: false },
              ],
              next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
            },
    })
    expect(await spotify.listPlaylists()).toEqual([
      { id: 'a', name: 'Mine' },
      { id: 'c', name: 'Collab' },
    ])
    expect(f.calls.every((c) => c.url.host === 'api.spotify.com')).toBe(true)
  })

  it('lit les morceaux via /items (champ item, ancien champ track en repli), ignore épisodes et fichiers locaux', async () => {
    const { spotify } = connector({
      'GET api.spotify.com/v1/playlists/p1/items': {
        items: [
          { item: track('1', 'One', 'A', 'usabc1234567') },
          { track: track('2', 'Two', 'B') },
          { item: { ...track('3', 'Pod', 'C'), type: 'episode' } },
          { item: { ...track('', 'Local', 'D'), id: null, is_local: true } },
          { item: null },
        ],
        next: null,
      },
    })
    expect(await spotify.getPlaylistTracks('p1')).toEqual([
      { title: 'One', artist: 'A', album: 'Album', durationMs: 200_000, isrc: 'USABC1234567', ids: { spotify: '1' } },
      { title: 'Two', artist: 'B', album: 'Album', durationMs: 200_000, isrc: undefined, ids: { spotify: '2' } },
    ])
  })

  it('resolve : cherche par ISRC d’abord', async () => {
    const { spotify, f } = connector({
      'GET api.spotify.com/v1/search': { tracks: { items: [track('9', 'Get Lucky', 'Daft Punk', 'USQX91300108')], next: null } },
    })
    const hit = await spotify.resolve({ title: 'x', artist: 'y', isrc: 'USQX91300108', ids: { youtube: 'v' } })
    expect(hit?.ids.spotify).toBe('9')
    expect(f.calls[0].url.searchParams.get('q')).toBe('isrc:USQX91300108')
    expect(f.calls[0].url.searchParams.get('limit')).toBe('10')
  })

  it('resolve : repli titre + artiste quand pas d’ISRC, null si aucun candidat ne colle', async () => {
    const { spotify, f } = connector({
      'GET api.spotify.com/v1/search': (url: URL) => ({
        tracks: { items: url.searchParams.get('q') === 'get lucky daft punk' ? [track('9', 'Get Lucky', 'Daft Punk')] : [] },
      }),
    })
    const yt = { title: 'Get Lucky (Official Audio)', artist: 'Daft Punk', durationMs: 205_000, ids: { youtube: 'v' } }
    expect((await spotify.resolve(yt))?.ids.spotify).toBe('9')
    expect(await spotify.resolve({ ...yt, title: 'Around the World' })).toBeNull()
    expect(f.calls).toHaveLength(2)
  })

  it('writePlaylist : crée via POST /me/playlists, ajoute par lots de 100, ignore les morceaux sans id Spotify', async () => {
    const { spotify, f } = connector({
      'POST api.spotify.com/v1/me/playlists': { id: 'new' },
      'POST api.spotify.com/v1/playlists/new/items': () => Response.json({ snapshot_id: 's' }, { status: 201 }),
    })
    const tracks = Array.from({ length: 150 }, (_, i) => ({ title: 't', artist: 'a', ids: { spotify: `s${i}` } }))
    tracks.push({ title: 'yt only', artist: 'a', ids: { youtube: 'v' } } as never)
    expect(await spotify.writePlaylist('Copie', tracks)).toBe('new')
    expect(JSON.parse(f.calls[0].body!)).toEqual({ name: 'Copie', public: false })
    const batches = f.calls.slice(1).map((c) => JSON.parse(c.body!).uris)
    expect(batches.map((b: string[]) => b.length)).toEqual([100, 50])
    expect(batches[0][0]).toBe('spotify:track:s0')
  })

  it('remonte une erreur API lisible', async () => {
    const { spotify } = connector({ 'GET api.spotify.com/v1/me': new Response('forbidden', { status: 403 }) })
    await expect(spotify.listPlaylists()).rejects.toThrow('403')
  })
})
