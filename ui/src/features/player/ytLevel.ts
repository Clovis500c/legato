import { type Levelling } from '../../shared/api'
import { setLevel, useLive } from './live'
import { usePlayer } from './store'
import { createLoudness } from './vizLoud'

/**
 * Same loudness across sources (Volume levelling, 2026-11-11): a YouTube song's integrated loudness as heard (live.js'
 * levels, before Adaptive Sound's gain and the volume) is kept per video (this PC only, localStorage, like ends.ts); its
 * next plays get the gain to -14 LUFS, where local files are levelled, applied in live.js. The first play of a video
 * plays as it is. Spotify plays in its own app: out of reach.
 */
const KEY = 'song-loudness'
const MAX = 3000
/** The level files are brought to (`music_player::level`). */
const TARGET = -14
/** Heard this long at least before its measure counts, ms. */
export const MEASURE_MS = 30_000

// Video id → integrated LUFS.
let known: Record<string, number> = {}
try {
  known = JSON.parse(localStorage.getItem(KEY) ?? '{}')
} catch {
  // No cache: measured again.
}

/**
 * The gain for `video` in this mode, dB: 0 when off or never measured. Boosts only, up to Adaptive Sound's +9 (the
 * limiter on): the measure is taken before the element's volume, where YouTube's own normalisation turns loud videos
 * down to about -14 already; a cut here would come on top of it. Album: as Song (a video has no album gain).
 */
export function levelDb(video: string | undefined, mode: Levelling): number {
  const l = video ? known[video] : undefined
  if (mode === 'off' || typeof l !== 'number' || !Number.isFinite(l)) return 0
  return Math.round(Math.min(9, Math.max(0, TARGET - l)) * 10) / 10
}

/** `video` sounded `lufs` loud over the whole of a play. */
export function rememberLoudness(video: string, lufs: number) {
  if (!Number.isFinite(lufs) || lufs < -70) return
  delete known[video]
  known[video] = Math.round(lufs * 10) / 10
  const ids = Object.keys(known)
  if (ids.length > MAX) for (const old of ids.slice(0, ids.length - MAX)) delete known[old]
  try {
    localStorage.setItem(KEY, JSON.stringify(known))
  } catch {
    // Storage off: this session only.
  }
}

/** Measures each YouTube song while `mode()` levels and sends live.js the gain of the one playing. Returns the stop. */
export function startLevelling(mode: () => Levelling): () => void {
  const meter = createLoudness()
  let video: string | undefined
  let heard = 0
  let last = performance.now()
  // The song's measure kept once it has been heard long enough; then the meter starts over for the next.
  const keep = () => {
    const i = meter.reading().integrated
    if (video && heard >= MEASURE_MS && i !== null) rememberLoudness(video, i)
  }
  const follow = () => {
    const now = usePlayer.getState().now
    const next = now?.via === 'youtube' ? now.youtubeId : undefined
    if (next !== video) {
      keep()
      meter.reset()
      video = next
      heard = 0
    }
    setLevel(levelDb(video, mode()))
  }
  follow()
  const offSong = usePlayer.subscribe((s, prev) => void (s.now !== prev.now && follow()))
  const offLevels = useLive.subscribe((s, prev) => {
    if (!s.levels || s.levels === prev.levels) return
    const t = performance.now()
    const ms = usePlayer.getState().playing ? Math.min(250, t - last) : 0
    last = t
    if (!video || mode() === 'off') return
    meter.push(s.levels, ms)
    heard += ms
  })
  return () => {
    keep()
    offSong()
    offLevels()
  }
}
