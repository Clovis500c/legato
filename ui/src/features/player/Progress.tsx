import { useState, useSyncExternalStore } from 'react'
import { formatDuration } from '../../shared/format'
import { Bar } from '../../shared/ui/controls'
import { usePlayer } from './store'

const clock = (ms: number | null) => formatDuration(ms) || '0:00'
/** Seek bar resolution: under a pixel on a full-width bar. */
const BAR_STEPS = 2000

/** Position between two source reports: last report + time since, while playing. Never past the end. */
export function extrapolate(reported: number, at: number, now: number, playing: boolean, durationMs: number | null): number {
  const p = playing ? reported + Math.max(0, now - at) : reported
  return durationMs ? Math.min(p, durationMs) : p
}

/** Down to a multiple of step (ms): what a display can show. */
export function quantize(ms: number, step: number): number {
  return step > 1 ? Math.floor(ms / step) * step : Math.round(ms)
}

// Last source report (YouTube ~4/s, engine 4/s), stamped on arrival.
let base = { ms: usePlayer.getState().positionMs, at: performance.now() }
usePlayer.subscribe((s, prev) => {
  if (s.positionMs !== prev.positionMs) base = { ms: s.positionMs, at: performance.now() }
})

// One frame loop for every bar and clock on screen, only while something listens (playing).
const ticks = new Set<() => void>()
let frameAt = performance.now()
let frame = 0
const loop = (t: number) => {
  frameAt = t
  for (const tick of ticks) tick()
  frame = requestAnimationFrame(loop)
}
function onFrame(tick: () => void) {
  ticks.add(tick)
  if (ticks.size === 1) frame = requestAnimationFrame(loop)
  return () => {
    ticks.delete(tick)
    if (!ticks.size) cancelAnimationFrame(frame)
  }
}
const still = () => () => {}

/**
 * Smooth position between reports. Re-renders only when it crosses `step` (ms): 1000 for a clock, a fraction of the
 * track for a bar. Every frame per component cost ~10 renders a frame at 144 Hz (2026-10-17 profile).
 */
export function usePosition(step = 1): number {
  const playing = usePlayer((s) => s.playing)
  const durationMs = usePlayer((s) => s.durationMs)
  // Reports re-render too: seeking while paused.
  usePlayer((s) => s.positionMs)
  return useSyncExternalStore(playing ? onFrame : still, () => quantize(extrapolate(base.ms, base.at, frameAt, playing, durationMs), step))
}

/** YouTube-like seek bar fed by the smooth position. While dragged it shows the pointer, not playback. */
export function SeekBar({ className = '' }: { className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const pos = usePosition(durationMs ? durationMs / BAR_STEPS : 1000)
  const [drag, setDrag] = useState<number | null>(null)
  return (
    <span className={`flex ${className}`} onPointerDown={() => setDrag(pos)} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      <Bar
        label="Position"
        seek
        value={drag ?? pos}
        max={durationMs ?? 0}
        onChange={(v) => {
          setDrag(v)
          seek(v)
        }}
        className="w-full"
      />
    </span>
  )
}

/** "0:54 / 2:52" (YouTube) or elapsed / remaining around the bar. */
export function TimeText({ part, className = '' }: { part: 'both' | 'elapsed' | 'remaining'; className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(1000)
  const text = part === 'both' ? `${clock(pos)} / ${clock(durationMs)}` : part === 'elapsed' ? clock(pos) : `-${clock(Math.max(0, (durationMs ?? 0) - pos))}`
  return <span className={`tabular-nums ${className}`}>{text}</span>
}
