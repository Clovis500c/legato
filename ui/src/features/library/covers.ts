import type { LibraryTrack } from '../../shared/api'
import { trackArt } from '../../shared/art'
import type { PlaylistCover } from '../../shared/theme/theme'
import { sortTracks } from './filter'

/** First `n` songs with artwork, in the playlist's order or a library sort. */
export function coverTracks(ids: number[] | undefined, byId: Map<number, LibraryTrack>, order: PlaylistCover['order'], n: number): LibraryTrack[] {
  const list = (ids ?? []).flatMap((id) => byId.get(id) ?? [])
  const sorted = order === 'playlist' ? list : sortTracks(list, order)
  const out: LibraryTrack[] = []
  for (const t of sorted) {
    if (out.length === n) break
    if (trackArt(t).length && !out.some((x) => x.art === t.art)) out.push(t)
  }
  return out
}

