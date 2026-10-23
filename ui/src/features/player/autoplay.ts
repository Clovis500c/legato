import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { songsThatFit } from '../library/fit'
import { onQueueEnd, remoteTrack, usePlayer } from './store'

/** Songs added when Up next runs out. */
const MORE = 15

/**
 * Up next ran out (setting autoplay, "Then, similar songs"): YouTube Music's radio from the last song when signed in,
 * else songs of your library that fit what just played (today's mixes, same artists). False = nothing to add.
 */
async function similarSongs(): Promise<boolean> {
  if (!useSettings.getState().settings.autoplay) return false
  const { list, index, enqueue } = usePlayer.getState()
  const recent = list.slice(Math.max(0, index - 4), index + 1)
  const last = list[index]
  if (!last) return false
  const had = new Set(list.map((t) => t.ids.youtube ?? `#${t.id}`))
  const fresh = (t: LibraryTrack) => !had.has(t.ids.youtube ?? `#${t.id}`)
  const { status, tracks, stats } = useStore.getState()
  let more: LibraryTrack[] = []
  const video = last.ids.youtube
  if (status.youtube.connected && video) more = (await api.ytmList({ type: 'radio', videoId: video, playlistId: `RDAMVM${video}` }).catch(() => [])).map(remoteTrack).filter(fresh).slice(0, MORE)
  if (!more.length) {
    const mixes = await api.mixes().catch(() => [])
    more = songsThatFit(recent, tracks, { stats, mixes }, MORE * 2).map((f) => f.track).filter(fresh).slice(0, MORE)
  }
  if (!more.length) return false
  enqueue(more, false)
  return true
}

onQueueEnd(similarSongs)
