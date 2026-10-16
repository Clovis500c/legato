import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../shared/format'
import { Bar } from '../../shared/ui/controls'
import { usePlayer } from './store'

const clock = (ms: number | null) => formatDuration(ms) || '0:00'

/** Position between two source reports: last report + time since, while playing. Never past the end. */
export function extrapolate(reported: number, at: number, now: number, playing: boolean, durationMs: number | null): number {
  const p = playing ? reported + Math.max(0, now - at) : reported
  return durationMs ? Math.min(p, durationMs) : p
}

/**
 * Smooth position at 60 fps. Sources report a few times a second (YouTube ~4/s, engine 4/s): the bar would step.
 * Only the components using it re-render each frame, not the whole screen.
 */
export function usePosition(): number {
  const positionMs = usePlayer((s) => s.positionMs)
  const playing = usePlayer((s) => s.playing)
  const durationMs = usePlayer((s) => s.durationMs)
  const base = useRef({ ms: positionMs, at: performance.now() })
  const [shown, setShown] = useState(positionMs)
  useEffect(() => {
    base.current = { ms: positionMs, at: performance.now() }
    setShown(positionMs)
  }, [positionMs])
  useEffect(() => {
    if (!playing) return
    let id = 0
    const tick = (now: number) => {
      setShown(extrapolate(base.current.ms, base.current.at, now, true, durationMs))
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, durationMs])
  return shown
}

/** YouTube-like seek bar fed by the smooth position. While dragged it shows the pointer, not playback. */
export function SeekBar({ className = '' }: { className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const pos = usePosition()
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
  const pos = usePosition()
  const text = part === 'both' ? `${clock(pos)} / ${clock(durationMs)}` : part === 'elapsed' ? clock(pos) : `-${clock(Math.max(0, (durationMs ?? 0) - pos))}`
  return <span className={`tabular-nums ${className}`}>{text}</span>
}
