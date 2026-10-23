import type { LibraryTrack } from '../../shared/api'
import { primaryArtist } from './filter'

/** Why a song fits a playlist: one of its artists, or a mix of today's that shares songs with it. */
export interface Fit {
  track: LibraryTrack
  mix?: string
}

/**
 * Songs of your library that fit a playlist, none already in it: today's mixes that share songs with it first (they
 * know your taste), then the playlist's artists, most played first.
 */
export function songsThatFit(playlist: LibraryTrack[], tracks: LibraryTrack[], { stats, mixes = [] }: { stats: Record<number, [number, number]>; mixes?: { id: string; trackIds: number[] }[] }, max = 5): Fit[] {
  const inside = new Set(playlist.map((t) => t.id))
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const out: Fit[] = []
  const add = (t: LibraryTrack | undefined, mix?: string) => {
    if (t && out.length < max && !inside.has(t.id) && !out.some((f) => f.track.id === t.id)) out.push({ track: t, mix })
  }
  for (const m of mixes) if (m.trackIds.some((id) => inside.has(id))) m.trackIds.forEach((id) => add(byId.get(id), m.id))
  const artists = new Set(playlist.map((t) => primaryArtist(t.artist)))
  const plays = (t: LibraryTrack) => stats[t.id]?.[0] ?? 0
  tracks
    .filter((t) => artists.has(primaryArtist(t.artist)))
    .sort((a, b) => plays(b) - plays(a))
    .forEach((t) => add(t))
  return out
}
