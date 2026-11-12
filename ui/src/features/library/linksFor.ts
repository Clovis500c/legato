import type { ArtistLink } from '../../shared/api'

/** What MusicBrainz answered, and for whom: the artist page stays mounted when it moves to another artist. */
export type Found = { artist: string; links: ArtistLink[] }

/** The links found for `artist`, or null (not asked yet, or found for another artist). */
export const linksFor = (found: Found | null, artist: string) => (found?.artist === artist ? found.links : null)
