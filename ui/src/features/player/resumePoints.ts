/** Songs at least this long (audiobooks, podcasts, DJ sets) are picked up where they were left. */
export const LONG_MS = 20 * 60_000
/** Not worth resuming this close to the start or the end. */
const MARGIN_MS = 30_000
const MAX_POINTS = 200

export type Points = Record<string, { ms: number; at: number }>

const worth = (ms: number, durationMs: number) => durationMs >= LONG_MS && ms >= MARGIN_MS && ms <= durationMs - MARGIN_MS

/** The points with this song's updated; a position not worth keeping (near an end, a short song) takes it out. Oldest go past MAX_POINTS. */
export function withPoint(points: Points, key: string, ms: number, durationMs: number, now: number): Points {
  const out = { ...points }
  if (worth(ms, durationMs)) out[key] = { ms: Math.round(ms), at: now }
  else delete out[key]
  const keys = Object.keys(out)
  if (keys.length > MAX_POINTS) for (const k of keys.sort((a, b) => out[a].at - out[b].at).slice(0, keys.length - MAX_POINTS)) delete out[k]
  return out
}

/** Where to pick this song up, or null (no point, or the song is not the length it was). */
export const pointFor = (points: Points, key: string, durationMs: number): number | null => {
  const p = points[key]
  return p && worth(p.ms, durationMs) ? p.ms : null
}
