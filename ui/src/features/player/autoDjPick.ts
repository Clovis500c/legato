import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { primaryArtist, type PlayStats } from '../library/filter'

/** Auto-DJ's rules (Settings › Playback › Auto-DJ). */
export interface DjRules {
  /** Songs heard in the last this many days wait for the others (0: no wait). */
  fresh: number
  /** Your ratings weigh in (`weight`). */
  rated: boolean
  /** Songs before the same artist again (0: any time). */
  gap: number
}

/** How often a song comes up: unrated 1, rated 2^((half stars - 6) / 2): five stars 4, three 1, one a quarter. */
export const weight = (stars: number | undefined, rated: boolean) => (rated && stars ? 2 ** ((stars - 6) / 2) : 1)

/** An artist of a song in your Liked Music: their songs come up this many times as often (with `rated`). */
export const LIKED_BOOST = 2

/** Your liked songs by artist (folded primary artist): what a pick by them is "because of". */
export type LikedArtists = ReadonlyMap<string, readonly { id: number; title: string }[]>

const artistKey = (t: Pick<LibraryTrack, 'artist'>) => fold(primaryArtist(t.artist))

/** `liked`: your Liked Music's song ids. */
export function likedArtists(tracks: readonly LibraryTrack[], liked: ReadonlySet<number>): LikedArtists {
  const by = new Map<string, { id: number; title: string }[]>()
  for (const t of tracks) {
    if (!liked.has(t.id)) continue
    const k = artistKey(t)
    by.set(k, [...(by.get(k) ?? []), { id: t.id, title: t.title }])
  }
  return by
}

/** Why a pick weighed more, shown in Up next: its stars, or an artist you liked (`self`: that song only). */
export type DjWhy = { kind: 'stars'; stars: number } | { kind: 'liked'; title: string; self: boolean }

/** The reason a pick came up more often than an unrated song, if any: only the rules' own boosts, nothing made up. */
export function djWhy(t: LibraryTrack, stats: PlayStats, rules: DjRules, liked: LikedArtists): DjWhy | undefined {
  if (!rules.rated) return undefined
  const stars = stats[t.id]?.[2] ?? 0
  if (stars >= 8) return { kind: 'stars', stars: stars / 2 }
  const songs = liked.get(artistKey(t))
  if (!songs?.length) return undefined
  const other = songs.find((s) => s.id !== t.id)
  return { kind: 'liked', title: (other ?? songs[0]).title, self: !other }
}

/** One of `items`, at random by weight. */
function weighted<T>(items: readonly T[], w: (x: T) => number, rand: () => number): T {
  const ws = items.map(w)
  let r = rand() * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) if ((r -= ws[i]) < 0) return items[i]
  return items[items.length - 1]
}

/**
 * The Auto-DJ's next `n` songs from `pool` (playable ones), after `queue` (the list so far, last last): at random by
 * weight, never a video marked not music. Each rule gives way rather than leave nothing: songs heard lately wait while
 * others are left; songs of the queue come back once all have played, never from its last half; an artist plays
 * again within `gap` songs only when no one else is left. Artists you liked weigh `LIKED_BOOST` times more (with your
 * ratings). `now`: unix seconds.
 */
export function djPick(pool: readonly LibraryTrack[], queue: readonly LibraryTrack[], stats: PlayStats, rules: DjRules, n: number, now: number, rand = Math.random, liked: LikedArtists = new Map()): LibraryTrack[] {
  const songs = pool.filter((t) => t.musicness !== 'notMusic')
  if (!songs.length) return []
  const since = now - rules.fresh * 86_400
  const lately = (t: LibraryTrack) => rules.fresh > 0 && (stats[t.id]?.[1] ?? 0) >= since
  // Folded once per song: a big library is 10 000 of them.
  const artists = new Map<number, string>()
  const artistOf = (t: LibraryTrack) => {
    let a = artists.get(t.id)
    if (a === undefined) artists.set(t.id, (a = artistKey(t)))
    return a
  }
  const line = [...queue]
  const picks: LibraryTrack[] = []
  while (picks.length < n) {
    const used = new Set(line.map((t) => t.id))
    const recent = new Set(line.slice(-Math.ceil(songs.length / 2)).map((t) => t.id))
    const tiers = [(t: LibraryTrack) => !used.has(t.id) && !lately(t), (t: LibraryTrack) => !used.has(t.id), (t: LibraryTrack) => !recent.has(t.id), () => true]
    let tier: LibraryTrack[] = []
    for (const keep of tiers) if ((tier = songs.filter(keep)).length) break
    const near = new Set(rules.gap > 0 ? line.slice(-rules.gap).map(artistOf) : [])
    const apart = tier.filter((t) => !near.has(artistOf(t)))
    const pick = weighted(apart.length ? apart : tier, (t) => weight(stats[t.id]?.[2], rules.rated) * (rules.rated && liked.has(artistOf(t)) ? LIKED_BOOST : 1), rand)
    picks.push(pick)
    line.push(pick)
  }
  return picks
}
