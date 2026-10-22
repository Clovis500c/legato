/**
 * Seek bar drag. Only a pointer press pins the bar to the pointer; keyboard changes seek at once. A drag belongs to the
 * song it started on: a song change drops it, so the bar can't stay stuck on an old position (2026-10-20 bug: a range
 * moved with the arrow keys set the drag with no pointer release to clear it).
 */
export type Drag = { value: number; track: string } | null

/** Pointer pressed on the bar. */
export const press = (track: string, pos: number): Drag => ({ value: pos, track })

/** Range moved. Pointer down: follow it, seek on release. Keyboard: seek now. */
export function move(d: Drag, value: number): { drag: Drag; seek: number | null } {
  return d ? { drag: { ...d, value }, seek: null } : { drag: null, seek: value }
}

/** Pointer released, cancelled or lost (window blur, capture lost). Seek only on the song the drag started on. */
export function release(d: Drag, track: string): { drag: Drag; seek: number | null } {
  return { drag: null, seek: d && d.track === track ? d.value : null }
}

/** What the bar shows: the drag on its own song, else playback. */
export const shown = (d: Drag, track: string, pos: number) => (d && d.track === track ? d.value : pos)
