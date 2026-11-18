import { api } from '../../shared/api'
import { songKey } from './effects'
import { useChapters } from './chapters'
import { splitIntoParts, usePlayer } from './store'
import { useSettings } from '../../app/settings'

/** Only a long video is asked about (a song of 3 minutes has no parts): 15 minutes or more. */
const MIN_VIDEO_MS = 15 * 60_000

/**
 * Follows the player: a song of the library played from a file asks Rust for its chapters (only `.m4b` / `.m4a` / `.mp4` answer);
 * a long video, with the setting on, asks YouTube, and its answer splits it into its parts in Up next (store.ts).
 */
export function startChapters(): () => void {
  let last: string | null | undefined
  // The video asked about: its parts playing on (rows of their own) keep its chapters, never asked again.
  let lastVideo: string | undefined
  // A video whose length is not known yet (a YouTube Music home item): asked once the player learns it.
  let waiting: string | undefined
  return usePlayer.subscribe((s) => {
    const key = songKey(s.now)
    const answer = (list: Awaited<ReturnType<typeof api.trackChapters>>) => songKey(usePlayer.getState().now) === key && useChapters.setState({ list })
    const video = s.now?.via === 'youtube' ? s.now.youtubeId : undefined
    if (key !== last) {
      last = key
      if (video && video === lastVideo && (s.now?.trackId ?? 0) < 0) return
      lastVideo = video
      useChapters.setState({ list: [] })
      waiting = video && useSettings.getState().settings.youtubeChapters ? video : undefined
      const id = s.now?.trackId
      if (s.now?.via === 'local' && id !== undefined && id > 0) api.trackChapters(id).then(answer, () => {})
    }
    if (!waiting || !s.durationMs) return
    const asked = waiting
    if (s.durationMs >= MIN_VIDEO_MS)
      api.youtubeChapters(asked).then((list) => {
        if (usePlayer.getState().now?.youtubeId !== asked) return
        useChapters.setState({ list })
        splitIntoParts(asked, list)
      }, () => {})
    waiting = undefined
  })
}
