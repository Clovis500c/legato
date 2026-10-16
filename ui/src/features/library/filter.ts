import type { LibraryTrack, Source } from '../../shared/api'
import { fold } from '../../shared/format'

export type Filter = 'all' | Source | 'unlinked'
export type Sort = 'artist' | 'title' | 'album' | 'recent' | 'duration'

const sourceCount = (t: LibraryTrack) => Object.keys(t.ids).length

/** Unlinked = known on one service only. */
export function filterTracks(tracks: LibraryTrack[], query: string, filter: Filter): LibraryTrack[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  return tracks.filter((t) => {
    if (filter === 'unlinked' ? sourceCount(t) > 1 : filter !== 'all' && !t.ids[filter]) return false
    if (!words.length) return true
    const hay = fold(`${t.title} ${t.artist} ${t.album ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
}

const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** Library arrives sorted by artist; other orders client-side. recent = highest row id first. */
export function sortTracks(tracks: LibraryTrack[], sort: Sort): LibraryTrack[] {
  const by = {
    artist: (a: LibraryTrack, b: LibraryTrack) => coll.compare(a.artist, b.artist) || coll.compare(a.title, b.title),
    title: (a: LibraryTrack, b: LibraryTrack) => coll.compare(a.title, b.title),
    album: (a: LibraryTrack, b: LibraryTrack) => coll.compare(a.album ?? '￿', b.album ?? '￿') || coll.compare(a.title, b.title),
    recent: (a: LibraryTrack, b: LibraryTrack) => b.id - a.id,
    duration: (a: LibraryTrack, b: LibraryTrack) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
  }[sort]
  return [...tracks].sort(by)
}

/** First credited artist: "Daft Punk, Pharrell Williams" → "Daft Punk". "&" kept: duo names (Polo & Pan). */
export const primaryArtist = (artist: string) => artist.split(/\s*(?:,|\bfeat\.?|\bft\.?)\s+/i)[0].trim() || artist

export interface AlbumGroup {
  album: string
  artist: string
  tracks: LibraryTrack[]
}

export function groupAlbums(tracks: LibraryTrack[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>()
  for (const t of tracks) {
    if (!t.album) continue
    const artist = primaryArtist(t.artist)
    const key = fold(`${t.album}\u0000${artist}`)
    const g = map.get(key) ?? map.set(key, { album: t.album, artist, tracks: [] }).get(key)!
    g.tracks.push(t)
  }
  return [...map.values()].sort((a, b) => coll.compare(a.album, b.album))
}

/** cover = a track of the artist to borrow art from (first one with art). */
export function groupArtists(tracks: LibraryTrack[]): { artist: string; count: number; albums: number; cover: LibraryTrack }[] {
  const map = new Map<string, { artist: string; count: number; albums: Set<string>; cover: LibraryTrack }>()
  for (const t of tracks) {
    const artist = primaryArtist(t.artist)
    const g = map.get(fold(artist)) ?? map.set(fold(artist), { artist, count: 0, albums: new Set(), cover: t }).get(fold(artist))!
    g.count++
    if (t.album) g.albums.add(fold(t.album))
    if (!g.cover.art && t.art) g.cover = t
  }
  return [...map.values()].map((g) => ({ artist: g.artist, count: g.count, albums: g.albums.size, cover: g.cover })).sort((a, b) => coll.compare(a.artist, b.artist))
}

export function libraryStats(tracks: LibraryTrack[]) {
  const perSource: Record<Source, number> = { spotify: 0, youtube: 0, local: 0, apple: 0 }
  let linked = 0
  for (const t of tracks) {
    for (const s of Object.keys(t.ids) as Source[]) perSource[s]++
    if (sourceCount(t) > 1) linked++
  }
  return {
    total: tracks.length,
    perSource,
    sources: Object.values(perSource).filter(Boolean).length,
    unlinked: tracks.length - linked,
    linkedPct: tracks.length ? Math.round((linked / tracks.length) * 100) : 0,
  }
}
