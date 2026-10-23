import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { songsThatFit } from '../library/fit'
import { remoteTrack, usePlayer } from './store'

const keyOf = (t: LibraryTrack) => t.ids.youtube ?? `#${t.id}`

/**
 * Songs like `seed` (last first): YouTube Music's radio from the last one when signed in, else songs of your library
 * that fit (today's mixes, same artists). Songs in `skip` (YouTube id or #library id) left out.
 */
export async function similarTo(seed: LibraryTrack[], skip: Set<string>, max: number): Promise<LibraryTrack[]> {
  const last = seed.at(-1)
  if (!last) return []
  const fresh = (t: LibraryTrack) => !skip.has(keyOf(t))
  const { status, tracks, stats } = useStore.getState()
  const video = last.ids.youtube
  if (status.youtube.connected && video) {
    const radio = (await api.ytmList({ type: 'radio', videoId: video, playlistId: `RDAMVM${video}` }).catch(() => [])).map(remoteTrack).filter(fresh)
    if (radio.length) return radio.slice(0, max)
  }
  const mixes = await api.mixes().catch(() => [])
  return songsThatFit(seed, tracks, { stats, mixes }, max * 2)
    .map((f) => f.track)
    .filter(fresh)
    .slice(0, max)
}

/** Right-click › Start radio: the song, then songs like it. */
export async function startRadio(t: LibraryTrack) {
  const more = await similarTo([t], new Set([keyOf(t)]), 30)
  if (!more.length) return useStore.getState().notify(tr('No similar songs found'))
  usePlayer.getState().playTracks([t, ...more], 0)
}
