import { api } from '../../shared/api'
import { songKey } from './effects'
import { useChapters } from './chapters'
import { usePlayer } from './store'
import { useSettings } from '../../app/settings'

/** Only a long video is asked about (a song of 3 minutes has no parts): 15 minutes or more. */
const MIN_VIDEO_MS = 15 * 60_000

/** Follows the player: a song of the library played from a file asks Rust for its chapters (only `.m4b` / `.m4a` / `.mp4` answer). */
export function startChapters(): () => void {
  let last: string | null | undefined
  return usePlayer.subscribe((s) => {
    const key = songKey(s.now)
    if (key === last) return
    last = key
    useChapters.setState({ list: [] })
    const video = s.now?.via === 'youtube' ? s.now.youtubeId : undefined
    if (video && s.durationMs && s.durationMs >= MIN_VIDEO_MS && useSettings.getState().settings.youtubeChapters) {
      api.youtubeChapters(video).then(
        (list) => songKey(usePlayer.getState().now) === key && useChapters.setState({ list }),
        () => {},
      )
      return
    }
    const id = s.now?.trackId
    if (s.now?.via !== 'local' || id === undefined || id <= 0) return
    api.trackChapters(id).then(
      (list) => songKey(usePlayer.getState().now) === key && useChapters.setState({ list }),
      () => {},
    )
  })
}
