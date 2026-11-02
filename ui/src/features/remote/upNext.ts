import type { LibraryTrack, RemoteSong } from '../../shared/api'
import { queueRows } from '../player/queue'

/** The phone remote's Up next: the songs after the current one in play order, title and artist only. */
export function upNextSongs(list: LibraryTrack[], order: number[], index: number, max = 30): RemoteSong[] {
  const rows = queueRows(order, index, (i) => !!list[i])
  const at = rows.findIndex((r) => r.current)
  return rows.slice(at + 1, at + 1 + max).map((r) => ({ title: list[r.i].title, artist: list[r.i].artist }))
}
