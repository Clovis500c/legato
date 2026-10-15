import { expect, it } from 'vitest'
import { Library } from './library'
import { bestMatch } from './match'
import { sync } from './sync'
import type { Connector, Source, Track } from './types'

function fake(source: Source, playlists: Record<string, Track[]>, catalog: Track[] = [], connected = true): Connector {
  return {
    source,
    isConnected: () => connected,
    connect: async () => {},
    listPlaylists: async () => Object.keys(playlists).map((id) => ({ id, name: `${source} ${id}` })),
    getPlaylistTracks: async (id) => {
      if (id === 'broken') throw new Error('403')
      return playlists[id]
    },
    search: async () => catalog,
    resolve: async (t) => bestMatch(t, catalog),
    writePlaylist: async () => 'x',
  }
}

const getLucky: Track = { title: 'Get Lucky', artist: 'Daft Punk', durationMs: 248_000, isrc: 'USQX91300108', ids: { spotify: 's1' } }
const hello: Track = { title: 'Hello', artist: 'Adele', durationMs: 295_000, ids: { spotify: 's2' } }

it('importe YouTube, relie chaque vidéo à son morceau Spotify, sans doublon', async () => {
  const lib = new Library()
  const youtube = fake('youtube', {
    PL1: [
      { title: 'Get Lucky (Official Audio)', artist: 'Daft Punk', durationMs: 250_000, ids: { youtube: 'v1' } },
      { title: 'Hello', artist: 'Adele', durationMs: 367_000, ids: { youtube: 'v2' } }, // long clip, fuzzy fails in lib
      { title: 'Unknown Demo', artist: 'Nobody', ids: { youtube: 'v3' } },
    ],
    broken: [],
  })
  const spotify = fake('spotify', { p1: [getLucky] }, [getLucky, { ...hello, durationMs: 365_000 }])

  const report = await sync(lib, [spotify, youtube], spotify)

  expect(report.playlists).toBe(2)
  expect(report.errors).toEqual(['youtube « youtube broken » : 403'])
  expect(report.matched).toBe(1)
  const byTitle = Object.fromEntries(lib.tracks().map((t) => [t.title, t.ids]))
  expect(byTitle).toEqual({
    'Get Lucky': { spotify: 's1', youtube: 'v1' },
    Hello: { youtube: 'v2', spotify: 's2' },
    'Unknown Demo': { youtube: 'v3' },
  })
  lib.close()
})

it('ignore les services non connectés et saute le matching sans cible connectée', async () => {
  const lib = new Library()
  const report = await sync(lib, [fake('youtube', { PL1: [] }, [], false)], fake('spotify', {}, [getLucky], false))
  expect(report).toEqual({ playlists: 0, matched: 0, errors: [] })
  lib.close()
})
