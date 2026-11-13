import { api } from '../../shared/api'
import { remember } from './sweetData'
import { usePlayer } from './store'

/** Under Sweet fades, follows the player: when the song or the next one changes, asks what is kept of their ends (cached measures only). */
export function startSweetLoad(enabled: () => boolean): () => void {
  let last = ''
  return usePlayer.subscribe((s) => {
    if (!enabled() || s.now?.via !== 'local') return
    const ids = [s.list[s.index]?.id, s.list[s.index + 1]?.id].filter((n): n is number => typeof n === 'number' && n > 0)
    const key = ids.join(',')
    if (!ids.length || key === last) return
    last = key
    api.songEnds(ids).then(remember, () => {})
  })
}
