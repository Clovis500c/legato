import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { groupAlbums, primaryArtist, type AlbumGroup } from './filter'

// "Cola - Single", "Live EP", "Tracks (EP)".
const RELEASE = /(^|[\s([-])(single|ep)[)\]]?\s*$/i

/**
 * A single or EP rather than an album. Release types aren't stored: the name says so, or the "album" is named after
 * one of its few songs (a single's usual shape).
 */
export const isSingle = (g: AlbumGroup) => RELEASE.test(g.album) || (g.tracks.length <= 3 && g.tracks.some((t) => fold(t.title) === fold(g.album)))

/** An artist's releases in your library, albums and singles apart, the ones you have most of first. */
export function discography(tracks: LibraryTrack[], artist: string): { albums: AlbumGroup[]; singles: AlbumGroup[] } {
  const groups = groupAlbums(tracks.filter((t) => fold(primaryArtist(t.artist)) === fold(artist))).sort((a, b) => b.tracks.length - a.tracks.length)
  return { albums: groups.filter((g) => !isSingle(g)), singles: groups.filter(isSingle) }
}
