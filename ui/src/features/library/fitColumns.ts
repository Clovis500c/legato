import type { Column } from '../../shared/theme/theme'

// Narrowest each column stays readable at (px); the title wants room for its cover and some words.
const MIN: Record<Column, number> = { album: 100, sources: 76, plays: 52, rating: 72, added: 92, duration: 52 }
const NUMBER = 32
const TITLE = 200
const ARTIST = 100
const GAP = 16
// Least needed first: the artist then moves under the title (no loss), the album goes last.
const DROP: (Column | 'artist')[] = ['added', 'plays', 'rating', 'sources', 'artist', 'album']

/**
 * The song list's columns that fit a list `width` px wide (a small window, a pane beside it): the least needed go first
 * until the rest fits. `actions` = the hover buttons' column. Width unknown (0, not measured yet): all of them.
 */
export function fitColumns(columns: readonly Column[], artist: boolean, width: number, actions: number) {
  let shown = [...columns]
  let artistCol = artist
  const need = () => {
    const cells = shown.length + (artistCol ? 1 : 0)
    return NUMBER + TITLE + actions + (artistCol ? ARTIST : 0) + shown.reduce((n, c) => n + MIN[c], 0) + GAP * (cells + 2)
  }
  for (const c of DROP) {
    if (width <= 0 || need() <= width) break
    if (c === 'artist') artistCol = false
    else shown = shown.filter((x) => x !== c)
  }
  return { columns: shown, artistCol }
}
