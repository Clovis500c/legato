// Cover Art Archive's front cover of a MusicBrainz release group (250 px; it redirects to archive.org, both allowed by
// the `art` scheme). Only for an id of the shape MusicBrainz uses; shown only when the setting is on.
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const releaseCover = (id: string): string | null => (MBID.test(id) ? `https://coverartarchive.org/release-group/${id.toLowerCase()}/front-250` : null)
