import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type Bookmark } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { usePlayer } from './store'

/** The playing library song's bookmarks (moments to come back to, a note with them): none for a dropped file. */
export const useBookmarks = create<{ trackId?: number; list: Bookmark[] }>(() => ({ list: [] }))

export const bookmarkTime = (b: Bookmark) => formatDuration(b.ms) || '0:00'

/** Keeps the playing song's bookmarks loaded. Returns cleanup. */
export function startBookmarks(): () => void {
  let shown: number | undefined
  const follow = () => {
    const id = usePlayer.getState().now?.trackId
    if (id === shown) return
    shown = id
    useBookmarks.setState({ trackId: id, list: [] })
    if (id === undefined) return
    void api.bookmarks(id).then(
      (list) => shown === id && useBookmarks.setState({ trackId: id, list }),
      () => {},
    )
  }
  follow()
  return usePlayer.subscribe(follow)
}

/** The playing song and its moment now: the last report (a quarter of a second behind at most), close enough. */
export function momentNow(): { trackId: number; ms: number } | null {
  const { now, positionMs } = usePlayer.getState()
  return now?.trackId === undefined ? null : { trackId: now.trackId, ms: Math.round(positionMs) }
}

/** A moment kept, with a note when given (taken before a dialog: the song moves on while you type). */
export async function addBookmark({ trackId: id, ms }: { trackId: number; ms: number }, note = '') {
  const list = await api.addBookmark(id, ms, note).catch(() => null)
  if (!list) return void useStore.getState().notify(tr('No room for more bookmarks in this song: remove one first.'), { kind: 'error' })
  if (useBookmarks.getState().trackId === id) useBookmarks.setState({ list })
  useStore.getState().notify(tr('Bookmark added at {time}', { time: formatDuration(ms) || '0:00' }))
}

export async function removeBookmark(b: Bookmark) {
  const list = await api.deleteBookmark(b.id, b.trackId).catch(() => null)
  if (list && useBookmarks.getState().trackId === b.trackId) useBookmarks.setState({ list })
}

/** Back to a bookmark of the playing song. */
export function goToBookmark(b: Bookmark) {
  if (usePlayer.getState().now?.trackId === b.trackId) usePlayer.getState().seek(b.ms)
}
