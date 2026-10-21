import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatDuration } from '../../shared/format'
import { Bar } from '../../shared/ui/controls'
import { move, press, release, shown, type Drag } from './seekDrag'
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
  // One failing listener must not stop every bar.
  for (const tick of ticks) {
    try {
      tick()
    } catch (e) {
      console.error(e)
    }
  }
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

/**
 * YouTube-like seek bar fed by the smooth position. While a pointer drags it, it shows the pointer and seeks on release;
 * arrow keys seek at once. A drag never outlives its song (`seekDrag.ts`).
 */
export function SeekBar({ className = '' }: { className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const track = String(usePlayer((s) => s.playId))
  const pos = usePosition(durationMs ? durationMs / BAR_STEPS : 1000)
  const [drag, setDrag] = useState<Drag>(null)
  // Ref too: input events can arrive before React re-renders after pointerdown.
  const live = useRef<Drag>(null)
  const put = (d: Drag) => setDrag((live.current = d))
  const end = useRef(() => {})

  useEffect(() => () => end.current(), [])

  return (
    <span
      className={`flex ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        put(press(String(usePlayer.getState().playId), pos))
        // Released anywhere (outside the bar, outside the window) or focus lost: the drag ends.
        const finish = () => {
          end.current()
          const r = release(live.current, String(usePlayer.getState().playId))
          put(r.drag)
          if (r.seek !== null) usePlayer.getState().seek(r.seek)
        }
        end.current()
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('blur', finish)
        end.current = () => {
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('blur', finish)
          end.current = () => {}
        }
      }}
    >
      <Bar
        label="Position"
        seek
        value={shown(drag, track, pos)}
        max={durationMs ?? 0}
        onChange={(v) => {
          const r = move(live.current, v)
          put(r.drag)
          if (r.seek !== null) seek(r.seek)
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
