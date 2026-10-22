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

/** How long a line is sung, guessed from its length (LRC gives starts only): 3 to 8 s. */
const sungMs = (text: string) => Math.min(8000, Math.max(3000, text.length * 90))
/** A pause at least this long shows a ♪ line instead of keeping the last words lit. */
const BREAK_MS = 4000

/**
 * Lines with ♪ breaks (text '') where nothing is sung (user's request 2026-10-22): the intro, long instrumental parts
 * between lines, the outro. Empty lines the lyrics already hold are breaks too.
 */
export function withBreaks(lines: { ms: number; text: string }[], durationMs: number | null): { ms: number; text: string }[] {
  if (!lines.length) return lines
  const out: { ms: number; text: string }[] = []
  if (lines[0].ms >= BREAK_MS) out.push({ ms: 0, text: '' })
  lines.forEach((l, i) => {
    out.push(l)
    if (!l.text) return
    const end = l.ms + sungMs(l.text)
    const next = i + 1 < lines.length ? lines[i + 1].ms : durationMs
    if (next !== null && next - end >= BREAK_MS) out.push({ ms: end, text: '' })
  })
  return out
}

/** When line `i` ends: the next line (or ♪ break) starts, else a guess from its length, the song's end at most. */
export function lineEnd(lines: { ms: number; text: string }[], i: number, durationMs: number | null): number {
  const guess = lines[i].ms + sungMs(lines[i].text)
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
