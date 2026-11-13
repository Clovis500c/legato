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

/** What is known of a song's ends: its tempo, the silence after its music (ms) and its loudness (LUFS). */
export interface Ends {
  bpm?: number
  tailMs?: number
  lufs?: number
}

/** A song that ends in this much silence already fades itself out: a long crossfade would only overlap the quiet. */
const TAIL_MS = 3000
const TAIL_FADE_S = 2
/** Loudness gap (dB) under which two songs meet softly enough, and the most it stretches a fade (x1.5 at 12 dB more). */
const LEVEL_DB = 6

/**
 * The fade out and fade in between `a` and `b` for Settings › Playback › Sweet fades: `sweetSeconds`' tempo reading,
 * stretched up to half again when the songs' loudness differ by more than 6 dB (a quiet song after a loud one comes in
 * gently), and the fade out cut to 2 s when `a` ends in 3 s of silence or more (it fades out by itself). What is not
 * known is left as the user set it. Loudness and silences come from the files' earlier measures (local songs only).
 */
export function sweetFade(a: Ends | undefined, b: Ends | undefined, base: { out: number; in: number }): { out: number; in: number } {
  const gap = a?.lufs !== undefined && b?.lufs !== undefined ? Math.abs(a.lufs - b.lufs) : 0
  const gentle = gap > LEVEL_DB ? 1 + Math.min(gap - LEVEL_DB, LEVEL_DB) / (2 * LEVEL_DB) : 1
  const stretch = (s: number) => (s > 0 ? Math.min(s * gentle, MAX_S) : 0)
  let out = stretch(sweetSeconds(a, b, base.out))
  if (a?.tailMs !== undefined && a.tailMs >= TAIL_MS && out > 0) out = Math.min(out, TAIL_FADE_S)
  return { out, in: stretch(sweetSeconds(a, b, base.in)) }
}
