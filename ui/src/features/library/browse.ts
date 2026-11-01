import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { groupAlbums, groupArtists, primaryArtist, type AlbumGroup, type ArtistGroup } from './filter'

/**
 * Songs' column browser (MusicBee, iTunes): artists, then the albums of those picked, then the songs of what's picked.
 * Picks are folded names, grouped as the Albums and Artists pages group them. A pick no longer there (a search, a
 * source chip) is left out: the list never ends up empty because of it.
 */
export interface Picks {
  artists: string[]
  albums: string[]
}

export type Keyed<G> = G & { key: string }

export interface Pane<G> {
  items: Keyed<G>[]
  /** Picked keys still there; none = All. */
  on: Set<string>
  /** The songs the pane covers (its All). */
  tracks: LibraryTrack[]
}

export interface Browsed {
  artists: Pane<ArtistGroup>
  albums: Pane<AlbumGroup>
  /** The songs of what's picked. */
  songs: LibraryTrack[]
}

const artistOf = (t: LibraryTrack) => fold(primaryArtist(t.artist))
const albumKey = (album: string, artist: string) => fold(`${album}\u0000${artist}`)
const albumOf = (t: LibraryTrack) => (t.album ? albumKey(t.album, primaryArtist(t.artist)) : '')

const still = (picked: string[], items: { key: string }[]) => {
  const there = new Set(items.map((g) => g.key))
  return new Set(picked.filter((k) => there.has(k)))
}

export function browse(tracks: LibraryTrack[], picks: Picks): Browsed {
  const artists = groupArtists(tracks).map((g) => ({ ...g, key: fold(g.artist) }))
  const a = still(picks.artists, artists)
  const byArtist = a.size ? tracks.filter((t) => a.has(artistOf(t))) : tracks
  const albums = groupAlbums(byArtist).map((g) => ({ ...g, key: albumKey(g.album, g.artist) }))
  const b = still(picks.albums, albums)
  return { artists: { items: artists, on: a, tracks }, albums: { items: albums, on: b, tracks: byArtist }, songs: b.size ? byArtist.filter((t) => b.has(albumOf(t))) : byArtist }
}

/** Other songs (the hidden videos' fold) narrowed to what's picked. */
export const inPicks = (tracks: LibraryTrack[], b: Browsed) => tracks.filter((t) => (!b.artists.on.size || b.artists.on.has(artistOf(t))) && (!b.albums.on.size || b.albums.on.has(albumOf(t))))

/** How a row was picked: plain (only it), toggle (Ctrl), range (Shift, from the anchor). */
export type How = 'only' | 'toggle' | 'range'

/** A click in a pane, keys in the pane's order. key null = All: nothing picked. */
export function pickIn(keys: string[], on: string[], key: string | null, how: How, anchor: string | null): string[] {
  if (key === null) return []
  if (how === 'toggle') return on.includes(key) ? on.filter((k) => k !== key) : [...on, key]
  const [from, to] = [anchor === null ? -1 : keys.indexOf(anchor), keys.indexOf(key)]
  if (how === 'range' && from >= 0 && to >= 0) return keys.slice(Math.min(from, to), Math.max(from, to) + 1)
  return [key]
}
