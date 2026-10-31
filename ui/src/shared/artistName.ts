import { tr } from './i18n/i18n'

/** The word the library stores for an untagged song (`music_core::local`). Matching, keys and sync stay on it. */
export const UNKNOWN_ARTIST = 'Unknown artist'

/** An artist as drawn on screen: the stored word in the interface's language. Not for data that leaves the app. */
export const artistName = (artist: string): string => (artist === UNKNOWN_ARTIST ? tr('Unknown artist') : artist)
