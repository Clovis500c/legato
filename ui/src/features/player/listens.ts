import { api, type Play } from '../../shared/api'

/** Current listen, reported once when it ends (feeds mixes). */
interface Listen {
  trackId: number
  /** Unix seconds. */
  startedAt: number
  /** Forward progress only: seeking ahead doesn't count as listening. */
  heardMs: number
  lastMs: number
  durationMs: number | null
}

let cur: Listen | null = null

/** Natural end = completed; else complete past 90 %. Under 2 s = accidental click, not recorded. */
export function toPlay(l: Listen, ended: boolean): Play | null {
  const completed = ended || (!!l.durationMs && l.lastMs >= 0.9 * l.durationMs)
  if (!completed && l.heardMs < 2000) return null
  return { trackId: l.trackId, startedAt: l.startedAt, listenedMs: Math.round(l.heardMs), completed }
}

/** Someone else wants finished listens too (Last.fm), with the song's length. */
let listener: ((play: Play, durationMs: number | null) => void) | null = null
export const onListenEnd = (f: typeof listener) => void (listener = f)

export function endListen(ended: boolean) {
  const play = cur && toPlay(cur, ended)
  const durationMs = cur?.durationMs ?? null
  cur = null
  if (!play) return
  api.recordPlay(play).catch(() => {})
  listener?.(play, durationMs)
}

/** Ends the previous listen (not completed), starts one for `trackId` (none = dropped file, untracked). */
export function startListen(trackId: number | undefined, durationMs: number | null) {
  endListen(false)
  if (trackId !== undefined) cur = { trackId, startedAt: Math.floor(Date.now() / 1000), heardMs: 0, lastMs: 0, durationMs }
}

export function progress(positionMs: number, durationMs?: number | null) {
  if (!cur) return
  const step = positionMs - cur.lastMs
  // Polls come every ~250 ms; bigger jumps are seeks.
  if (step > 0 && step < 5000) cur.heardMs += step
  cur.lastMs = positionMs
  if (durationMs) cur.durationMs = durationMs
}
