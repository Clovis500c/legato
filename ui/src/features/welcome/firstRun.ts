import { spotifyList } from '../../shared/format'

/** First launch: shown once, while the library is still empty (an update never shows it to someone with music). */
export function shouldWelcome(welcomed: boolean, songs: number, playlists: number): boolean {
  return !welcomed && songs === 0 && playlists === 0
}

/** What a pasted link brings: a public Spotify playlist or album (imported whole), or a YouTube song. */
export function linkKind(text: string): 'spotify' | 'youtube' | null {
  if (spotifyList(text)) return 'spotify'
  return /youtu\.?be/i.test(text) ? 'youtube' : null
}
