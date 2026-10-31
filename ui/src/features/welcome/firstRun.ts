import { appleLink, deezerLink, spotifyList } from '../../shared/format'

/** First launch: shown once, while the library is still empty (an update never shows it to someone with music). */
export function shouldWelcome(welcomed: boolean, songs: number, playlists: number): boolean {
  return !welcomed && songs === 0 && playlists === 0
}

/** What a pasted link brings: a public Spotify, Deezer or Apple Music playlist or album (imported whole), or a YouTube song. */
export type LinkKind = 'spotify' | 'deezer' | 'apple' | 'youtube'
export function linkKind(text: string): LinkKind | null {
  if (spotifyList(text)) return 'spotify'
  if (deezerLink(text)) return 'deezer'
  if (appleLink(text)) return 'apple'
  return /youtu\.?be/i.test(text) ? 'youtube' : null
}

/** A link that imports a whole playlist or album (not a single YouTube song). */
export const isListLink = (text: string) => ['spotify', 'deezer', 'apple'].includes(linkKind(text) ?? '')
