import { fold } from '../../shared/format'
import { primaryArtist } from '../library/filter'

/**
 * Seeds for `similarTo`, which starts YouTube Music's radio from the last one: the most played songs, the most played
 * one YouTube can start from last. Its first song, too. Unplayed: the set's order (an album's first song).
 */
export function radioSeeds<T extends { ids: { youtube?: string } }>(songs: T[], plays: (t: T) => number, max = 5): T[] {
  const sorted = [...songs].sort((a, b) => plays(b) - plays(a))
  const lead = sorted.find((t) => t.ids.youtube) ?? sorted[0]
  if (!lead) return []
  return [...sorted.filter((t) => t !== lead).slice(0, max - 1).reverse(), lead]
}

/** A radio's queue: its first song, then songs like it with the set's own songs mixed in, one in `every`. */
export function radioQueue<T>(first: T, similar: T[], own: T[], every = 3): T[] {
  const out = [first]
  let o = 0
  for (const t of similar) {
    if (o < own.length && out.length % every === 0) out.push(own[o++])
    out.push(t)
  }
  return out
}

/** A radio's name, from its songs: their album, else their artist, else none. */
export function radioName(songs: { album: string | null; artist: string }[]): string | undefined {
  const album = songs[0]?.album?.trim()
  if (album && songs.every((t) => t.album && fold(t.album.trim()) === fold(album))) return album
  const artist = songs[0] && primaryArtist(songs[0].artist)
  if (artist && songs.every((t) => fold(primaryArtist(t.artist)) === fold(artist))) return artist
  return undefined
}

/** Shuffled copy (Fisher–Yates). */
export function shuffled<T>(xs: T[], rand = Math.random): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
