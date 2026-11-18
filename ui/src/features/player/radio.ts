import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type YtmHome } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { songsThatFit } from '../library/fit'
import { radioName, radioQueue, radioSeeds, shuffled } from './radioMix'
import { K } from './score'
import type { Candidate } from './similarRank'
import { playPicks, remoteTrack, usePlayer } from './store'
import { crowdOf, fansOf, seedsOf } from './crowd'
import { discoveryCandidates } from './discovery'
import { primaryArtist } from '../library/filter'
import type { PickWhy } from './pickWhy'
import { usePickWhy } from './pickWhyStore'
import { loadTaste, tasteFor, useTaste } from './taste'

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

/** The radio plays, endless (autoplay.ts goes on with songs like the last few). */
function playRadio(list: LibraryTrack[], name: string | undefined) {
  usePlayer.getState().playTracks(list, 0)
  if (usePlayer.getState().list === list) usePlayer.setState({ radio: true, fromKind: 'radio', from: name ? tr('{name} radio', { name }) : tr('Radio') })
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

/** The local hour for the time-of-day signal, only once there are enough plays of history to read it from. */
const timeOfDay = (stats: Record<number, [plays: number, last: number, stars?: number] | undefined>) => (Object.values(stats).reduce((n, s) => n + (s?.[0] ?? 0), 0) >= K.timeOfDay.minPlays ? new Date().getHours() : undefined)

/** What a pick around `seeds` is made from: the library, the merged YouTube Music radios of the seeds, signed in or out (their votes and order count), your taste. At most one request per seed (3 for Up next's end, 1 for a mix), through the app's cache. */
async function around(seeds: LibraryTrack[], extra: (t: LibraryTrack) => Promise<Candidate[]> = async () => []) {
  const { settings } = useSettings.getState()
  const { tracks, stats } = useStore.getState()
  const fresh = (t: LibraryTrack) => !(settings.hideExplicit && t.explicit) && t.musicness !== 'notMusic'
  const candidates: Candidate[] = tracks.filter(fresh).map((track) => ({ track }))
  // The radios of the last songs, signed in or out (the public ones), merged: a song in several carries votes (crowd.ts).
  const radios = await crowdOf(seeds.flatMap((t) => (t.ids.youtube ? [t.ids.youtube] : [])), async (video) => (await api.ytmList({ type: 'radio', videoId: video, playlistId: `RDAMVM${video}` })).map(remoteTrack).filter(fresh))
  candidates.push(...radios, ...(await extra(seeds[0])).filter((c) => fresh(c.track)))
  // Never in mixes and recent skips come from the taste store (loaded when idle; asked here only if it is still empty).
  if (!useTaste.getState().loaded) await loadTaste()
  return { candidates, library: tracks, taste: tasteFor(stats, useTaste.getState().signals), variety: settings.similarVariety, hour: timeOfDay(stats) }
}

/**
 * The songs added when Up next runs out: ranked against the whole queue and what you rated and play (similarRank.ts),
 * scored by your taste with a dose of the new (docs/recommendation.md).
 */
export async function similarForQueue(list: LibraryTrack[], index: number, max: number): Promise<LibraryTrack[]> {
  const last = list[index]
  if (!last) return []
  const { candidates, library, taste, variety, hour } = await around(seedsOf(list, index, 3))
  // Loaded when Up next runs out, not at launch.
  const { pickSimilar } = await import('./similarRank')
  const why = new Map<number, PickWhy>()
  const picks = pickSimilar(candidates, list, index, taste, variety, max, Math.random, library, hour, why)
  // Kept beside the earlier picks' reasons: Up next shows them under the songs.
  usePickWhy.setState((old) => ({ ...old, ...Object.fromEntries(why) }))
  return picks
}

/** Right-click › Start a mix from this song: 30 songs of its style laid out as an arc (songMix.ts, a chunk loaded here), named "<Title> mix". */
export async function startMix(seed: LibraryTrack) {
  // Where the seed is on YouTube: its artist's "Fans might also like", the top songs of 2 of them (crowd.ts); a refusal or none leaves the radio alone.
  const fans = async (t: LibraryTrack): Promise<Candidate[]> => {
    if (!t.ids.youtube) return []
    const page = await api.ytmArtist(primaryArtist(t.artist), [t.title], t.ids.youtube).catch(() => null)
    // Their pages by channel id (the carousel's): the exact artist, never a namesake found by a search.
    return fansOf(page?.related ?? [], async (id) => ((await api.ytmChannel(id))?.songs ?? []).map((s) => remoteTrack(s)))
  }
  const { candidates, library, taste, variety, hour } = await around([seed], fans)
  const { mixFromSong } = await import('./songMix')
  const why = new Map<number, PickWhy>()
  const list = mixFromSong({ seed, candidates, taste, variety, rand: Math.random, library, hour, why })
  if (list.length < 2) return useStore.getState().notify(tr('No similar songs found'))
  // Its songs after the seed are the app's picks: an early skip steers the rest of its artist (store.ts).
  playPicks(list, why, 1)
  if (usePlayer.getState().list === list) usePlayer.setState({ from: tr('{title} mix', { title: seed.title }), fromKind: 'mix', fromId: undefined })
}

/**
 * Home › New for you (signed in; slice 5 of docs/recommendation.md): 20 songs from what YouTube Music's Home shelves offer and the library does
 * not hold, ranked by our score against the songs you played last, with the explore dose; named "New for you".
 */
export async function startDiscovery(home: YtmHome) {
  const { settings } = useSettings.getState()
  const { tracks, stats, notify } = useStore.getState()
  const candidates = discoveryCandidates(home.shelves, tracks).filter((c) => !(settings.hideExplicit && c.track.explicit))
  // The queue the picks are made against: the last songs you played, most recent last.
  const recent = tracks.filter((t) => (stats[t.id]?.[1] ?? 0) > 0).sort((a, b) => (stats[a.id]?.[1] ?? 0) - (stats[b.id]?.[1] ?? 0)).slice(-3)
  if (!candidates.length || !recent.length) return notify(tr('No similar songs found'))
  if (!useTaste.getState().loaded) await loadTaste()
  const why = new Map<number, PickWhy>()
  const { pickSimilar } = await import('./similarRank')
  const picks = pickSimilar(candidates, recent, recent.length - 1, tasteFor(stats, useTaste.getState().signals), settings.similarVariety, 20, Math.random, tracks, timeOfDay(stats), why)
  if (picks.length < 2) return notify(tr('No similar songs found'))
  playPicks(picks, why)
  if (usePlayer.getState().list === picks) usePlayer.setState({ from: tr('New for you'), fromKind: 'mix', fromId: undefined })
}
