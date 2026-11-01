import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { djPick, type DjRules } from './autoDjPick'
import { vias } from './sources'
import { usePlayer } from './store'

/** Songs the Auto-DJ queues at a time: at its start, then each time Up next runs out. */
const BATCH = 10

const rules = (): DjRules => {
  const s = useSettings.getState().settings
  return { fresh: s.djFresh, rated: s.djRated, gap: s.djGap }
}

/** The pool's songs still in the library and playable now, picked by the rules after `queue`. */
function pick(pool: readonly number[], queue: readonly LibraryTrack[]): LibraryTrack[] {
  const { tracks, stats, status } = useStore.getState()
  const keep = new Set(pool)
  const songs = tracks.filter((t) => keep.has(t.id) && vias(t, status.spotify.connected).length > 0)
  return djPick(songs, queue, stats, rules(), BATCH, Date.now() / 1000)
}

/** Auto-DJ from `songs` (Songs, an album, an artist, a playlist): its picks play, more come as Up next runs out. */
export function startAutoDj(songs: readonly LibraryTrack[], name?: string) {
  const pool = songs.map((t) => t.id)
  const picks = pick(pool, [])
  if (!picks.length) return useStore.getState().notify(tr('Nothing here the Auto-DJ can play'))
  usePlayer.getState().playTracks(picks, 0)
  if (usePlayer.getState().list === picks) usePlayer.setState({ dj: pool, from: name ? tr('Auto-DJ: {name}', { name }) : tr('Auto-DJ') })
}

/** Up next ran out with the Auto-DJ on (autoplay.ts): its next picks, at the end. False: nothing left to play. */
export function djMore(): boolean {
  const { dj, list, enqueue } = usePlayer.getState()
  if (!dj) return false
  const picks = pick(dj, list)
  if (!picks.length) return false
  enqueue(picks, false, false)
  return true
}

/** The queue plays to its end, then what Up next's setting says. */
export const stopAutoDj = () => usePlayer.setState({ dj: undefined })
