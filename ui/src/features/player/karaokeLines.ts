import type { LyricsFix } from './lyricsAt'

/** Where a line sits on the karaoke screen, from the line being sung (`at`, -1 before the first). */
export type Seat = 'past' | 'now' | 'next' | 'later' | 'hidden'

/** The line sung, the one before (fading), the next two (dimmed); the rest is not shown. */
export function seatOf(i: number, at: number): Seat {
  const d = i - at
  return d === 0 ? 'now' : d === -1 ? 'past' : d === 1 ? 'next' : d === 2 ? 'later' : 'hidden'
}

/** Line sliding to the middle: how far the column of lines moves (px, up is negative) to put a line at the view's centre. */
export const centerShift = (viewH: number, top: number, height: number) => Math.round(viewH / 2 - top - height / 2)

/**
 * Plain lyrics glide with the song: the text moves up by the share of the song played, over the room it has (the
 * text's height less the view's). No length known: still.
 */
export function plainShift(posMs: number, durationMs: number | null, contentH: number, viewH: number): number {
  if (!durationMs || durationMs <= 0) return 0
  const room = Math.max(0, contentH - viewH)
  return 0 - Math.round(Math.min(1, Math.max(0, posMs / durationMs)) * room)
}

/** Arrow keys move the lyrics: ← → half a second, ↓ ↑ a tenth (earlier, later). */
export function nudgeOf(code: string): number | null {
  return { ArrowLeft: -500, ArrowRight: 500, ArrowDown: -100, ArrowUp: 100 }[code] ?? null
}

/** The fix moved by `ms`, the speed kept. */
export const nudged = (fix: LyricsFix, ms: number): LyricsFix => ({ ...fix, offset: fix.offset + ms })
