import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { songsThatFit } from '../library/fit'
import { radioName, radioQueue, radioSeeds, shuffled } from './radioMix'
import type { Candidate } from './similarRank'
import { remoteTrack, usePlayer } from './store'

const keyOf = (t: LibraryTrack) => t.ids.youtube ?? `#${t.id}`

/**
 * Songs like `seed` (last first): YouTube Music's radio from the last one when signed in, else songs of your library
 * that fit (today's mixes, same artists). Songs in `skip` (YouTube id or #library id) left out.
 */
export async function similarTo(seed: LibraryTrack[], skip: Set<string>, max: number): Promise<LibraryTrack[]> {
  const last = seed.at(-1)
  if (!last) return []
  const hide = useSettings.getState().settings.hideExplicit
  const fresh = (t: LibraryTrack) => !skip.has(keyOf(t)) && !(hide && t.explicit)
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

/** The radio plays, endless (autoplay.ts goes on with songs like the last few, whatever the setting). */
function playRadio(list: LibraryTrack[], name: string | undefined) {
  usePlayer.getState().playTracks(list, 0)
  if (usePlayer.getState().list === list) usePlayer.setState({ radio: true, from: name ? tr('{name} radio', { name }) : tr('Radio') })
}

/** Right-click › Start radio: the song, then songs like it. */
export async function startRadio(t: LibraryTrack) {
  const more = await similarTo([t], new Set([keyOf(t)]), 30)
  if (!more.length) return useStore.getState().notify(tr('No similar songs found'))
  playRadio([t, ...more], t.title)
}

/**
 * Radio from a set of songs (an album, an artist, a playlist, a selection): its most played song, then songs like its
 * most played ones, with its own songs mixed in, one in three.
 */
export async function startRadioFrom(songs: LibraryTrack[], name = radioName(songs)) {
  const { stats, notify } = useStore.getState()
  const seeds = radioSeeds(songs, (t) => stats[t.id]?.[0] ?? 0)
  const lead = seeds.at(-1)
  if (!lead) return
  const more = await similarTo(seeds, new Set(songs.map(keyOf)), 30)
  if (!more.length) return notify(tr('No similar songs found'))
  playRadio(radioQueue(lead, more, shuffled(songs.filter((t) => t !== lead))), name)
}

/**
 * The songs "Then, similar songs" adds: ranked against the whole queue and what you rated and play (similarRank.ts),
 * from YouTube Music's radio of the last song when signed in (its order counts) and from your library. Nothing new is asked:
 * the one radio request is the one it always made.
 */
export async function similarForQueue(list: LibraryTrack[], index: number, max: number): Promise<LibraryTrack[]> {
  const { settings } = useSettings.getState()
  const { status, tracks, stats } = useStore.getState()
  const last = list[index]
  if (!last) return []
  const fresh = (t: LibraryTrack) => !(settings.hideExplicit && t.explicit) && t.musicness !== 'notMusic'
  const taste = { rating: (t: LibraryTrack) => stats[t.id]?.[2] ?? 0, plays: (t: LibraryTrack) => stats[t.id]?.[0] ?? 0 }
  const candidates: Candidate[] = tracks.filter(fresh).map((track) => ({ track }))
  const video = last.ids.youtube
  if (status.youtube.connected && video) {
    const radio = (await api.ytmList({ type: 'radio', videoId: video, playlistId: `RDAMVM${video}` }).catch(() => [])).map(remoteTrack).filter(fresh)
    radio.forEach((track, rank) => candidates.push({ track, rank }))
  }
  // Loaded when Up next runs out, not at launch.
  const { pickSimilar } = await import('./similarRank')
  return pickSimilar(candidates, list, index, taste, settings.similarVariety, max)
}
