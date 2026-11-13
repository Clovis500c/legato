import { api } from '../../shared/api'
import { remember } from './sweetData'
import { nextIndex } from './queue'
import { passOver, usePlayer } from './store'

/** Under Sweet fades, follows the player: when the song or the next one changes, asks what is kept of their ends (cached measures only). */
export function startSweetLoad(enabled: () => boolean): () => void {
  let last = ''
  return usePlayer.subscribe((s) => {
    if (!enabled() || s.now?.via !== 'local') return
    // The next one as the store will pick it (`songFade`): shuffle and skips counted.
    const next = nextIndex(s.order, s.index, 1, s.repeat, true, (j) => passOver(s.list[j], s.skipLong))
    const ids = [s.list[s.index]?.id, next === null ? undefined : s.list[next]?.id].filter((n): n is number => typeof n === 'number' && n > 0)
    const key = ids.join(',')
    if (!ids.length || key === last) return
    last = key
    api.songEnds(ids).then(remember, () => {})
  })
}
