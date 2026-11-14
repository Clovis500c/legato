import type { View } from '../../app/store'

/** What a queue was started from: the page's kind, for the icon beside its name in Now Playing's "From …". */
export const FROM_KINDS = ['playlist', 'album', 'artist', 'songs', 'radio', 'mix', 'walk', 'dj'] as const
export type FromKind = (typeof FROM_KINDS)[number]

/** The page a queue is played from: its name, its kind, and the playlist id (its own small cover). Undefined on a page that is no list. Pure: `view` and `playlists` come from the stores. */
export function contextOf(view: View, playlists: { id: number; name: string }[], words: { songs: string }): { from: string; kind: FromKind; id?: number } | undefined {
  if (view.name === 'playlist') {
    const name = playlists.find((p) => p.id === view.id)?.name
    return name ? { from: name, kind: 'playlist', id: view.id } : undefined
  }
  if (view.name === 'album') return { from: view.album, kind: 'album' }
  if (view.name === 'artist') return { from: view.artist, kind: 'artist' }
  if (view.name === 'songs') return { from: words.songs, kind: 'songs' }
  return undefined
}

/** The accessible name of the whole label. */
export const fromAria = (from: string, name: string) => `${from} ${name}`
