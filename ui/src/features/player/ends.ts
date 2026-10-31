/**
 * Early endings (user's request 2026-10-28): some videos run on after their song (silence, a silent end screen).
 * live.js hears the silence near the video's end; the song's real end is kept per video (this PC only, localStorage,
 * like still.ts) and later plays end there: the fade, the overlap and the next song start from the song's end.
 * Skip silence (2026-10-31) comes through here too: a local file's measured end is offered under `local:<path>` and
 * every end-of-song rule (fade, hand-over to the next song) reads it from `songEnd`, as for a video. The start of a
 * video (silence before the music, heard live) is learned the same way, kept as `song-starts`.
 */
const KEY = 'song-ends'
const MAX = 3000
// Video id → seconds where its song ends.
let known: Record<string, number> = {}
try {
  known = JSON.parse(localStorage.getItem(KEY) ?? '{}')
} catch {
  // No cache: learned again.
}

// Local file key → seconds where its music ends, from the engine (measured there, cached in SQLite): this session only.
const offered = new Map<string, number>()

/** The engine's measured end of a local song (key `local:<path>`); null / 0 = none (setting off, nothing to cut). */
export function offerEnd(key: string, seconds: number | null | undefined) {
  if (!(seconds && seconds > 0 && Number.isFinite(seconds))) return void offered.delete(key)
  offered.set(key, Math.round(seconds * 10) / 10)
  if (offered.size > 500) offered.delete(offered.keys().next().value!)
}

/** Where the song of `video` (or `local:<path>`) ends in its `durationMs`, ms: its learned end, else the whole. */
export function songEnd(video: string | undefined, durationMs: number): number {
  // The engine's / SponsorBlock's end and the learned one: the earlier wins.
  const s = video ? [offered.get(video), known[video]].reduce<number | undefined>((a, b) => (a === undefined || (b !== undefined && b < a) ? b : a), undefined) : undefined
  return s !== undefined && s * 1000 < durationMs ? s * 1000 : durationMs
}

/** The song of `video` ends `seconds` in. */
export function rememberEnd(video: string, seconds: number) {
  if (!(seconds > 0 && Number.isFinite(seconds))) return
  delete known[video]
  known[video] = Math.round(seconds * 10) / 10
  const ids = Object.keys(known)
  if (ids.length > MAX) for (const old of ids.slice(0, ids.length - MAX)) delete known[old]
  try {
    localStorage.setItem(KEY, JSON.stringify(known))
  } catch {
    // Storage off: this session only.
  }
}

const START_KEY = 'song-starts'
// Video id → seconds where its music starts (silence before it, 2 s or more).
let starts: Record<string, number> = {}
try {
  starts = JSON.parse(localStorage.getItem(START_KEY) ?? '{}')
} catch {
  // No cache: learned again.
}

/** Where the music of `video` starts, s (0 = at the start, or not known). */
export function songStart(video: string | undefined): number {
  const s = video ? starts[video] : undefined
  return typeof s === 'number' && s > 0 ? s : 0
}

/** The music of `video` starts `seconds` in (heard: silence before it). */
export function rememberStart(video: string, seconds: number) {
  if (!(seconds > 0 && Number.isFinite(seconds))) return
  delete starts[video]
  starts[video] = Math.round(seconds * 10) / 10
  const ids = Object.keys(starts)
  if (ids.length > MAX) for (const old of ids.slice(0, ids.length - MAX)) delete starts[old]
  try {
    localStorage.setItem(START_KEY, JSON.stringify(starts))
  } catch {
    // Storage off: this session only.
  }
}
