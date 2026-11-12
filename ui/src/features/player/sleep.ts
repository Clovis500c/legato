import { create } from 'zustand'
import type { Track } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import type { MenuEntry } from '../../shared/ui/ContextMenu'
import { chapterEnd, useChapters } from './chapters'
import { albumGoesOn } from './fade'
import { nextIndex } from './queue'
import { positionNow } from './Progress'
import { passOver, stopAfterSong, usePlayer } from './store'

/** The music fades out over the last 3 minutes before the timer ends. */
const FADE_MS = 180_000
export const SLEEP_MINUTES = [15, 30, 45, 60, 90] as const

interface Sleep {
  /** When the music stops (ms), or at the end of this song / album. null = off. */
  ends: number | 'song' | 'album' | 'chapter' | null
}
export const useSleep = create<Sleep>(() => ({ ends: null }))

let timer: ReturnType<typeof setTimeout> | undefined
// Album mode's watch on the queue.
let off: (() => void) | undefined

export function stopSleep() {
  clearTimeout(timer)
  clearInterval(timer)
  off?.()
  off = undefined
  stopAfterSong(null)
  useSleep.setState({ ends: null })
}

/**
 * The song playing is its album's last in the queue: the next one in play order (no wrap, whatever the repeat) is from
 * another album, or none. A song without an album is one by itself.
 */
export function albumEndsHere(p: { list: readonly Pick<Track, 'album' | 'artist'>[]; order: number[]; index: number }, skip?: (i: number) => boolean): boolean {
  const i = nextIndex(p.order, p.index, 1, 'off', true, skip)
  return !albumGoesOn(p.list[p.index], i === null ? undefined : p.list[i])
}

/** Music stops in `minutes` (fading out over the last 3), or at the end of this song or album. */
export function startSleep(minutes: number | 'song' | 'album' | 'chapter') {
  stopSleep()
  if (minutes === 'chapter') {
    // The playing book's chapter: pause when its end is reached (the last chapter: the song's end, as 'song').
    const list = useChapters.getState().list
    const end = chapterEnd(list, positionNow())
    if (end === null) return startSleep('song')
    timer = setInterval(() => {
      // Another song: its chapters are other ones.
      if (useChapters.getState().list !== list) return stopSleep()
      if (positionNow() < end) return
      usePlayer.getState().pauseNow()
      stopSleep()
    }, 250)
    return useSleep.setState({ ends: 'chapter' })
  }
  if (minutes === 'song') {
    stopAfterSong(() => useSleep.setState({ ends: null }))
    return useSleep.setState({ ends: 'song' })
  }
  if (minutes === 'album') {
    // Looked at again on each song and queue change: stops after the album's last song only.
    const look = () => {
      const p = usePlayer.getState()
      stopAfterSong(albumEndsHere(p, (j) => passOver(p.list[j], p.skipLong)) ? stopSleep : null)
    }
    look()
    off = usePlayer.subscribe((s, prev) => {
      if (s.index !== prev.index || s.order !== prev.order || s.list !== prev.list) look()
    })
    return useSleep.setState({ ends: 'album' })
  }
  const ms = minutes * 60_000
  timer = setTimeout(() => {
    usePlayer.getState().sleep(FADE_MS)
    timer = setTimeout(() => useSleep.setState({ ends: null }), FADE_MS)
  }, ms - FADE_MS)
  useSleep.setState({ ends: Date.now() + ms })
}

/** "23 min" left, "End of song", "End of album", "" when off. */
export function sleepLabel(ends: Sleep['ends'], now = Date.now()): string {
  if (ends === null) return ''
  if (ends === 'song') return tr('End of song')
  if (ends === 'album') return tr('End of album')
  if (ends === 'chapter') return tr('End of chapter')
  return tr('{n} min', { n: Math.max(1, Math.ceil((ends - now) / 60_000)) })
}

/** Menu: the lengths, end of song or album, off. */
export function sleepMenu(): MenuEntry[] {
  const { ends } = useSleep.getState()
  return [
    ...SLEEP_MINUTES.map((m) => ({ label: tr('{n} min', { n: m }), onSelect: () => startSleep(m) })),
    { label: tr('End of this song'), checked: ends === 'song', onSelect: () => startSleep('song') },
    { label: tr('End of this album'), checked: ends === 'album', onSelect: () => startSleep('album') },
    useChapters.getState().list.length > 0 && { label: tr('End of this chapter'), checked: ends === 'chapter', onSelect: () => startSleep('chapter') },
    ends !== null && '-',
    ends !== null && { label: tr('Turn off the sleep timer'), onSelect: stopSleep },
  ]
}
