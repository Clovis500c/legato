/** Line being sung at `ms` (the last one started), -1 before the first. Lines sorted by time. */
export function lineAt(lines: { ms: number }[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].ms <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** A synced line; endMs when the source gives it (YouTube Music), else guessed. */
export type Timed = { ms: number; text: string; endMs?: number | null }

/** Timing fixed by hand: song time = lyric time × rate + offset (ms). */
export type LyricsFix = { offset: number; rate: number }
export const NO_FIX: LyricsFix = { offset: 0, rate: 1 }

/** Lines moved to the song's own time. */
export function applyFix<T extends Timed>(lines: T[], fix: LyricsFix): T[] {
  if (fix.offset === 0 && fix.rate === 1) return lines
  const at = (ms: number) => Math.max(0, Math.round(ms * fix.rate + fix.offset))
  return lines.map((l) => ({ ...l, ms: at(l.ms), endMs: l.endMs == null ? l.endMs : at(l.endMs) }))
}

/** Taps further apart than this (lyric time) also fix the speed; closer, only the offset moves. */
const RATE_SPAN_MS = 8000

/**
 * "This line starts now" taps → fix. One tap: shift, same speed. Two far enough apart: the speed too (a slowed or sped
 * up version nobody named so), from the first and last tap; kept within 0.5–2×.
 */
export function fixFromTaps(taps: { lyric: number; song: number }[], prev: LyricsFix): LyricsFix {
  if (!taps.length) return prev
  const first = taps[0]
  const last = taps[taps.length - 1]
  const span = last.lyric - first.lyric
  const rate = Math.abs(span) >= RATE_SPAN_MS ? Math.min(2, Math.max(0.5, (last.song - first.song) / span)) : prev.rate
  return { rate: Math.round(rate * 10000) / 10000, offset: Math.round(last.song - last.lyric * rate) }
}

/** How long a line is sung, guessed from its length (LRC gives starts only): 3 to 8 s. */
const sungMs = (text: string) => Math.min(8000, Math.max(3000, text.length * 90))
/** A pause at least this long shows a ♪ line instead of keeping the last words lit. */
const BREAK_MS = 4000

/**
 * Lines with ♪ breaks (text '') where nothing is sung (user's request 2026-10-22): the intro, long instrumental parts
 * between lines, the outro. Empty lines the lyrics already hold are breaks too.
 */
export function withBreaks(lines: Timed[], durationMs: number | null): Timed[] {
  if (!lines.length) return lines
  const out: Timed[] = []
  if (lines[0].ms >= BREAK_MS) out.push({ ms: 0, text: '' })
  lines.forEach((l, i) => {
    out.push(l)
    if (!l.text) return
    const end = l.endMs ?? l.ms + sungMs(l.text)
    const next = i + 1 < lines.length ? lines[i + 1].ms : durationMs
    if (next !== null && next - end >= BREAK_MS) out.push({ ms: end, text: '' })
  })
  return out
}

/** When line `i` ends: its own end when the source gives it, else the next line (or ♪ break) or a guess from its length. */
export function lineEnd(lines: Timed[], i: number, durationMs: number | null): number {
  const guess = lines[i].endMs ?? lines[i].ms + sungMs(lines[i].text)
  const next = i + 1 < lines.length ? lines[i + 1].ms : (durationMs ?? guess)
  return Math.min(next, Math.max(guess, lines[i].ms + 1))
}

/**
 * Karaoke timing of a line being sung: when each word fills. LRC has no word timings, so the line's time is shared by
 * length (a long word takes longer). Words = the text split on spaces, spaces kept.
 */
export function wordTimes(text: string, start: number, end: number): { word: string; t0: number; t1: number }[] {
  const words = text.split(/(\s+)/).filter(Boolean)
  const total = Math.max(1, text.length)
  let at = 0
  return words.map((word) => {
    const t0 = start + ((end - start) * at) / total
    at += word.length
    return { word, t0, t1: start + ((end - start) * at) / total }
  })
}
