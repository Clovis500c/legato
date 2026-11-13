/** Smallest and longest a sweet fade runs, in seconds. */
const MIN_S = 1
const MAX_S = 12
/** A fade between songs of this much tempo apart (after folding half and double time) is "locked": cut to whole beats. */
const LOCKED = 0.04
/** Further apart than this the songs do not mix: a short fade. */
const APART = 0.12
const SHORT_S = 3
/** A fade of whole phrases: 8 beats at least. */
const PHRASE = 8

/** `b` folded into the octave of `a` (a song at double time still mixes with one at half time). */
function folded(a: number, b: number): number {
  let x = b
  while (x > a * 1.5) x /= 2
  while (x < a / 1.5) x *= 2
  return x
}

/**
 * Settings › Playback › Sweet fades: how long the fade between two songs runs, from what is known of both (their tempos,
 * the library's `bpm`), `base` being the fade the user set. Unknown tempo: `base` (nothing to go by). Tempos within 4%:
 * whole phrases of beats, the nearest to `base` (a fade that lands on the beat). Tempos within 12%: `base`. Further
 * apart: short, they would only clash. No fade (0) stays none. Not yet: silence and loudness at the ends (the player
 * does not know them until a song has played).
 */
export function sweetSeconds(a: { bpm?: number } | undefined, b: { bpm?: number } | undefined, base: number): number {
  if (!(base > 0) || !a?.bpm || !b?.bpm || a.bpm < 30 || b.bpm < 30) return base
  const gap = Math.abs(folded(a.bpm, b.bpm) - a.bpm) / a.bpm
  if (gap > APART) return Math.min(base, SHORT_S)
  if (gap > LOCKED) return base
  const beat = 60 / a.bpm
  const phrase = PHRASE * beat
  const n = Math.max(1, Math.round(base / phrase))
  const s = n * phrase
  // A phrase far longer than what was asked (a very slow song, a short fade): the user's seconds stand.
  return s > MAX_S || s > base * 2 ? base : Math.max(MIN_S, s)
}
