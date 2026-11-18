import type { LibraryPlaylist } from '../../shared/api'

/**
 * "Add to playlist ›" offers an imported playlist the app cannot write to at its source (`writable`: YouTube signed in, a
 * Subsonic server) too (the owner, 2026-11-17: imported ones were missing on the phone): the song goes into it here, stays
 * through its next imports and syncs like your own (2026-11-18). YouTube's own likes stay out: the heart button is theirs.
 */
export const addsHere = (p: LibraryPlaylist, writable: (p: LibraryPlaylist) => boolean) => !p.custom && !writable(p) && !(p.source === 'youtube' && p.sourceId.startsWith('LM'))
