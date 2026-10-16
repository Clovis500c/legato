import type { LibraryTrack, Source } from '../../shared/api'
import { fold } from '../../shared/format'

export type Filter = 'all' | Source | 'unlinked'
/** recent = added-new (playlist covers keep the old name). manual = playlist order. */
export type Sort = 'manual' | 'added-new' | 'added-old' | 'most-played' | 'recently-played' | 'title' | 'title-desc' | 'artist' | 'album' | 'duration' | 'duration-short' | 'random' | 'recent'

/** Track id → [listens, last start] (history), for the play sorts. */
export type PlayStats = Record<number, [number, number]>

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

// Stable pseudo-random rank per track for one Random pick (new seed = new order).
const rank = (id: number, seed: number) => {
  let h = (id ^ seed) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * Sorted copy. Library arrives sorted by artist. positional = a playlist: "date added" follows its order (grows at the
 * bottom, or newestFirst: Liked Music), library = added rank. Unplayed tracks go last in the play sorts.
 */
export function sortTracks(
  tracks: LibraryTrack[],
  sort: Sort,
  { stats = {}, seed = 1, positional = false, newestFirst = false }: { stats?: PlayStats; seed?: number; positional?: boolean; newestFirst?: boolean } = {},
): LibraryTrack[] {
  if (sort === 'manual') return [...tracks]
  if (positional && (sort === 'added-new' || sort === 'recent' || sort === 'added-old')) {
    const asIs = (sort === 'added-old') !== newestFirst
    return asIs ? [...tracks] : [...tracks].reverse()
  }
  const plays = (t: LibraryTrack) => stats[t.id]?.[0] ?? 0
  const last = (t: LibraryTrack) => stats[t.id]?.[1] ?? 0
  type By = (a: LibraryTrack, b: LibraryTrack) => number
  const title: By = (a, b) => coll.compare(a.title, b.title)
  const by: Record<Exclude<Sort, 'manual'>, By> = {
    'added-new': (a, b) => b.added - a.added,
    recent: (a, b) => b.added - a.added,
    'added-old': (a, b) => a.added - b.added,
    'most-played': (a, b) => plays(b) - plays(a) || last(b) - last(a) || title(a, b),
    'recently-played': (a, b) => last(b) - last(a),
    title,
    'title-desc': (a, b) => title(b, a),
    artist: (a, b) => coll.compare(a.artist, b.artist) || title(a, b),
    album: (a, b) => coll.compare(a.album ?? '￿', b.album ?? '￿') || title(a, b),
    duration: (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
    'duration-short': (a, b) => (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity),
    random: (a, b) => rank(a.id, seed) - rank(b.id, seed),
  }
  return [...tracks].sort(by[sort])
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
