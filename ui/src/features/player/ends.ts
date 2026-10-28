/**
 * Early endings (user's request 2026-10-28): some videos run on after their song (silence, a silent end screen).
 * live.js hears the silence near the video's end; the song's real end is kept per video (this PC only, localStorage,
 * like still.ts) and later plays end there: the fade, the overlap and the next song start from the song's end.
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

/** Where the song of `video` ends in its `durationMs` (the video's), ms: its learned end, else the video's. */
export function songEnd(video: string | undefined, durationMs: number): number {
  const s = video ? known[video] : undefined
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
