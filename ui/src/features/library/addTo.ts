import type { LibraryPlaylist } from '../../shared/api'

/**
 * "Add to playlist ›" offers an imported playlist through your own copy of it (the owner, 2026-11-17: imported ones were missing on
 * the phone) when the app cannot write to it now (`writable`: YouTube signed in, a Subsonic server); an edit of the mirror would be
 * undone by its next import. YouTube's own likes stay out: the heart button is theirs.
 */
export const takesCopy = (p: LibraryPlaylist, writable: (p: LibraryPlaylist) => boolean) => !p.custom && !writable(p) && !(p.source === 'youtube' && p.sourceId.startsWith('LM'))

/** Your own copy, found by the name Duplicate gives it. */
export const copyNamed = (name: string, playlists: readonly LibraryPlaylist[]) => playlists.find((p) => p.custom && p.name === name)
