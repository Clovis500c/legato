import type { LibraryTrack } from '../../shared/api'

/** What a local file without an artist tag is filed under (`music_core::local::read`). */
const NO_ARTIST = 'Unknown artist'

/** The health page's groups from the library: songs on a video found unplayable, local songs with no cover (Rust's scan),
 *  local songs missing their artist or album. */
export function healthGroups(tracks: LibraryTrack[], noCover: number[], broken: Set<string>) {
  const covers = new Set(noCover)
  return {
    broken: tracks.filter((t) => !!t.ids.youtube && broken.has(t.ids.youtube)),
    cover: tracks.filter((t) => covers.has(t.id)),
    info: tracks.filter((t) => !!t.ids.local && (t.artist === NO_ARTIST || !t.artist.trim() || !t.album?.trim())),
  }
}
