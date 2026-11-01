import type { LibraryPlaylist } from '../../shared/api'

// One Liked Music on screen (user's ask 2026-11-01). Yours holds likes YouTube Music hasn't got yet (a Spotify import,
// a like while signed out, songs with no YouTube version): beside the account's, it's folded into it, not listed twice.

export const LIKED = 'Liked Music'

export const youtubeLiked = (playlists: LibraryPlaylist[]) => playlists.find((p) => p.source === 'youtube' && !p.custom && p.sourceId === 'LM')
export const ownLiked = (playlists: LibraryPlaylist[]) => playlists.find((p) => p.custom && p.name === LIKED)

/** Yours on top, newest addition first (its list grows at the bottom), then the account's without them. */
export function fold<T>(own: T[], account: T[], id: (t: T) => number): T[] {
  const mine = new Set(own.map(id))
  return [...own].reverse().concat(account.filter((t) => !mine.has(id(t))))
}

export interface Lists {
  playlists: LibraryPlaylist[]
  orders: Record<number, number[]>
}

/** Both lists there: yours left out of the playlists, its songs in the account's order and count. */
export function oneLiked(raw: Lists): Lists {
  const own = ownLiked(raw.playlists)
  const yt = youtubeLiked(raw.playlists)
  if (!own || !yt) return raw
  const playlists = raw.playlists.filter((p) => p !== own)
  const mine = raw.orders[own.id]
  if (!mine?.length) return { playlists, orders: raw.orders }
  const order = fold(mine, raw.orders[yt.id] ?? [], (t) => t)
  return { playlists: playlists.map((p) => (p === yt ? { ...yt, trackCount: order.length } : p)), orders: { ...raw.orders, [yt.id]: order } }
}

/** Playlist ids whose songs a page shows: the account's Liked Music shows yours too. */
export function shownIds(id: number, raw: LibraryPlaylist[]): number[] {
  const own = ownLiked(raw)
  return own && youtubeLiked(raw)?.id === id ? [own.id, id] : [id]
}
