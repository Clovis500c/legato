import { create } from 'zustand'
import { tr } from '../../shared/i18n/i18n'
import type { MenuEntry } from '../../shared/ui/ContextMenu'
import { stopAfterSong, usePlayer } from './store'

/** The music fades out over the last 30 s before the timer ends. */
const FADE_MS = 30_000
export const SLEEP_MINUTES = [15, 30, 45, 60, 90] as const

interface Sleep {
  /** When the music stops (ms), or 'song' = at the end of this one. null = off. */
  ends: number | 'song' | null
}
export const useSleep = create<Sleep>(() => ({ ends: null }))

let timer: ReturnType<typeof setTimeout> | undefined

export function stopSleep() {
  clearTimeout(timer)
  stopAfterSong(null)
  useSleep.setState({ ends: null })
}

/** Music stops in `minutes` (fading out over the last 30 s), or at the end of this song. */
export function startSleep(minutes: number | 'song') {
  stopSleep()
  if (minutes === 'song') {
    stopAfterSong(() => useSleep.setState({ ends: null }))
    return useSleep.setState({ ends: 'song' })
  }
  const ms = minutes * 60_000
  timer = setTimeout(() => {
    usePlayer.getState().sleep(FADE_MS)
    timer = setTimeout(() => useSleep.setState({ ends: null }), FADE_MS)
  }, ms - FADE_MS)
  useSleep.setState({ ends: Date.now() + ms })
}

/** "23 min" left, "End of song", "" when off. */
export function sleepLabel(ends: Sleep['ends'], now = Date.now()): string {
  if (ends === null) return ''
  if (ends === 'song') return tr('End of song')
  return tr('{n} min', { n: Math.max(1, Math.ceil((ends - now) / 60_000)) })
}

/** Menu: the lengths, end of song, off. */
export function sleepMenu(): MenuEntry[] {
  const { ends } = useSleep.getState()
  return [
    ...SLEEP_MINUTES.map((m) => ({ label: tr('{n} min', { n: m }), onSelect: () => startSleep(m) })),
    { label: tr('End of this song'), checked: ends === 'song', onSelect: () => startSleep('song') },
    ends !== null && '-',
    ends !== null && { label: tr('Turn off the sleep timer'), onSelect: stopSleep },
  ]
}
