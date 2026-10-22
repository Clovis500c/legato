import type { LibraryTrack, Source, Track } from '../../shared/api'
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
 * bottom, or newestFirst: new songs on top), library = added rank. Unplayed tracks go last in the play sorts.
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
/**
 * First credited artist, as Albums and Artists group them: "A, B", "A feat. B", "A ft. B", "A x B" → A. YouTube's
 * channel names lose what isn't the artist's name: "A - Topic" (auto-generated channels), "AVEVO".
 */
export const primaryArtist = (artist: string) => {
  const first = artist.split(/\s*(?:,|\bfeat\.?|\bft\.?|\bfeaturing)\s+|\s+x\s+/i)[0].trim() || artist
  return first.replace(/\s+-\s+Topic$/i, '').replace(/(?<=\S)VEVO$/, '').trim() || first
}

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

export interface ArtistGroup {
  artist: string
  count: number
  albums: number
  /** A track to borrow art from (first one with art). */
  cover: LibraryTrack
  tracks: LibraryTrack[]
}

export function groupArtists(tracks: LibraryTrack[]): ArtistGroup[] {
  const map = new Map<string, { artist: string; albums: Set<string>; cover: LibraryTrack; tracks: LibraryTrack[] }>()
  for (const t of tracks) {
    const artist = primaryArtist(t.artist)
    const g = map.get(fold(artist)) ?? map.set(fold(artist), { artist, albums: new Set(), cover: t, tracks: [] }).get(fold(artist))!
    g.tracks.push(t)
    if (t.album) g.albums.add(fold(t.album))
    if (!g.cover.art && t.art) g.cover = t
  }
  return [...map.values()].map((g) => ({ artist: g.artist, count: g.tracks.length, albums: g.albums.size, cover: g.cover, tracks: g.tracks })).sort((a, b) => coll.compare(a.artist, b.artist))
}

/** Albums and Artists pages: sorts over a group's songs. */
export type GroupSort = 'name' | 'name-desc' | 'artist' | 'songs' | 'albums' | 'added-new' | 'added-old' | 'most-played' | 'recently-played' | 'length' | 'random'
/** How many of its songs you have: several, or just one. */
export type GroupSize = 'all' | 'several' | 'one'

/** What the sorts read from a group. Album: name = album, artist set. Artist: name = artist, albums set. */
export interface Grouped {
  name: string
  artist?: string
  albums?: number
  tracks: LibraryTrack[]
}

export interface GroupStats {
  /** Newest and oldest added rank of its songs. */
  newest: number
  oldest: number
  plays: number
  /** Last start, ms (0 = never). */
  last: number
  lengthMs: number
}

export function groupStats(g: Grouped, stats: PlayStats = {}): GroupStats {
  const out = { newest: 0, oldest: Infinity, plays: 0, last: 0, lengthMs: 0 }
  for (const t of g.tracks) {
    out.newest = Math.max(out.newest, t.added)
    out.oldest = Math.min(out.oldest, t.added)
    out.plays += stats[t.id]?.[0] ?? 0
    out.last = Math.max(out.last, stats[t.id]?.[1] ?? 0)
    out.lengthMs += t.durationMs ?? 0
  }
  return out
}

/** Size filter, then sorted copy. Ties fall back to the name. */
export function sortGroups<G extends Grouped>(groups: G[], sort: GroupSort, { size = 'all', stats = {}, seed = 1 }: { size?: GroupSize; stats?: PlayStats; seed?: number } = {}): G[] {
  const kept = size === 'all' ? groups : groups.filter((g) => (size === 'one' ? g.tracks.length === 1 : g.tracks.length > 1))
  const m = new Map(kept.map((g) => [g, groupStats(g, stats)]))
  const st = (g: G) => m.get(g)!
  const name = (a: G, b: G) => coll.compare(a.name, b.name)
  const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const by: Record<GroupSort, (a: G, b: G) => number> = {
    name,
    'name-desc': (a, b) => name(b, a),
    artist: (a, b) => coll.compare(a.artist ?? a.name, b.artist ?? b.name) || name(a, b),
    songs: (a, b) => b.tracks.length - a.tracks.length || name(a, b),
    albums: (a, b) => (b.albums ?? 0) - (a.albums ?? 0) || b.tracks.length - a.tracks.length || name(a, b),
    'added-new': (a, b) => st(b).newest - st(a).newest || name(a, b),
    'added-old': (a, b) => st(a).oldest - st(b).oldest || name(a, b),
    'most-played': (a, b) => st(b).plays - st(a).plays || st(b).last - st(a).last || name(a, b),
    'recently-played': (a, b) => st(b).last - st(a).last || name(a, b),
    length: (a, b) => st(b).lengthMs - st(a).lengthMs || name(a, b),
    random: (a, b) => rank(hash(a.name + (a.artist ?? '')), seed) - rank(hash(b.name + (b.artist ?? '')), seed),
  }
  return [...kept].sort(by[sort])
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

/**
 * Imported videos that clearly aren't music (talks, reactions, games: YouTube imports bring them along) set aside until
 * asked; a doubt stays. Nothing is deleted.
 */
export function musicOnly<T extends Pick<Track, 'musicness'>>(tracks: T[], showAll: boolean): { kept: T[]; hidden: number } {
  const hidden = tracks.filter((t) => t.musicness === 'notMusic').length
  return { kept: showAll || !hidden ? tracks : tracks.filter((t) => t.musicness !== 'notMusic'), hidden }
}
