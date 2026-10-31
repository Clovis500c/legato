import { create } from 'zustand'

/**
 * Skip non-music parts of music videos (user's choice 2026-10-31, Settings › Playback, off by default): SponsorBlock's
 * community segments (category music_offtopic), asked by hash prefix in Rust (`crates/connectors` sponsorblock.rs). Pure
 * rules here (no store, no settings: tests import it); the store acts on them (`player/store.ts`).
 */
export interface Seg {
  startS: number
  endS: number
}

/** Segments of the video that plays (the progress bar marks them). */
export const useSponsor = create<{ video?: string; segs: Seg[] }>(() => ({ segs: [] }))

/** The play reached a part at its start (or was on its way there, up to this far before it when data came late), s. */
const GRACE_S = 5
/** A part this close to its end is not worth a jump. */
const TAIL_S = 0.5

/**
 * The part to jump over at time `t`: the first one not done that playing has reached (`prev` = the last time heard
 * before this one, `begun` = where this play started). Never one the play began inside (a resume), one already
 * skipped (a seek back into it stays there) or one the play went past by a seek.
 */
export function toSkip(segs: readonly Seg[], t: number, prev: number, begun: number, done: ReadonlySet<number>): number {
  return segs.findIndex((s, i) => !done.has(i) && begun < s.startS + 0.5 && prev <= s.startS + GRACE_S && t >= s.startS && t < s.endS - TAIL_S)
}

/** Where the music ends when the last part runs to the end of the video (an outro): that part's start, else null. */
export function endCut(segs: readonly Seg[], durationS: number): number | null {
  if (!(durationS > 0)) return null
  const last = segs.at(-1)
  return last && last.endS >= durationS - 1 && last.startS > 1 ? last.startS : null
}

const KEY = 'sponsor-undone'
const MAX = 500
let undone = new Set<string>()
try {
  undone = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
} catch {
  // No memory: asked again.
}

/** Undo was pressed on this video: its parts are not skipped any more (this PC). */
export function isUndone(video: string): boolean {
  return undone.has(video)
}

export function rememberUndone(video: string) {
  undone.delete(video)
  undone.add(video)
  if (undone.size > MAX) undone.delete(undone.values().next().value!)
  try {
    localStorage.setItem(KEY, JSON.stringify([...undone]))
  } catch {
    // Storage off: this session only.
  }
}
