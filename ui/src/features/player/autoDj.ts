import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { locale, tr } from '../../shared/i18n/i18n'
import { ownLiked, youtubeLiked } from '../library/likedMusic'
import { djPick, djWhy, likedArtists, type DjRules, type DjWhy } from './autoDjPick'
import { vias } from './sources'
import { usePlayer } from './store'

/** Songs the Auto-DJ queues at a time: at its start, then each time Up next runs out. */
const BATCH = 10

const rules = (): DjRules => {
  const s = useSettings.getState().settings
  return { fresh: s.djFresh, rated: s.djRated, gap: s.djGap }
}

/** Why each pick came up more often (Up next shows it), by song id. */
export const useDjWhy = create<Record<number, DjWhy>>(() => ({}))

/** "Because you liked “Bloom”", "You gave it 5 stars". */
export const whyText = (w: DjWhy) =>
  w.kind === 'stars' ? tr('You gave it {n} stars', { n: new Intl.NumberFormat(locale()).format(w.stars) }) : w.self ? tr('In your Liked Music') : tr('Because you liked {title}', { title: tr('“{title}”', { title: w.title }) })

/** The pool's songs still in the library and playable now, picked by the rules after `queue`; their reasons kept. */
function pick(pool: readonly number[], queue: readonly LibraryTrack[]): LibraryTrack[] {
  const { tracks, stats, status, raw } = useStore.getState()
  const keep = new Set(pool)
  const songs = tracks.filter((t) => keep.has(t.id) && vias(t, status.spotify.connected).length > 0)
  // Liked Music, the account's and yours: their artists come up more.
  const liked = new Set([youtubeLiked(raw.playlists), ownLiked(raw.playlists)].flatMap((p) => (p ? (raw.orders[p.id] ?? []) : [])))
  const by = likedArtists(tracks, liked)
  const r = rules()
  const picks = djPick(songs, queue, stats, r, BATCH, Date.now() / 1000, Math.random, by)
  useDjWhy.setState(Object.fromEntries(picks.flatMap((t) => {
    const w = djWhy(t, stats, r, by)
    return w ? [[t.id, w]] : []
  })))
  return picks
}

/** Auto-DJ from `songs` (Songs, an album, an artist, a playlist): its picks play, more come as Up next runs out. */
export function startAutoDj(songs: readonly LibraryTrack[], name?: string) {
  const pool = songs.map((t) => t.id)
  useDjWhy.setState({}, true)
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
