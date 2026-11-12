import { api } from '../../shared/api'
import { songKey } from './effects'
import { useChapters } from './chapters'
import { usePlayer } from './store'

/** Follows the player: a song of the library played from a file asks Rust for its chapters (only `.m4b` / `.m4a` / `.mp4` answer). */
export function startChapters(): () => void {
  let last: string | null | undefined
  return usePlayer.subscribe((s) => {
    const key = songKey(s.now)
    if (key === last) return
    last = key
    useChapters.setState({ list: [] })
    const id = s.now?.trackId
    if (s.now?.via !== 'local' || id === undefined || id <= 0) return
    api.trackChapters(id).then(
      (list) => songKey(usePlayer.getState().now) === key && useChapters.setState({ list }),
      () => {},
    )
  })
}
