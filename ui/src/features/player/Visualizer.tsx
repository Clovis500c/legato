import { useEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { useLive } from './live'
import { usePlayer } from './store'
import { BARS, stepBars } from './bars'

const FLOOR = 0.04

/** The music as moving bars under the cover (Settings › Playback › Visualizer). Transform only, no layout per frame. */
export function Visualizer() {
  const ref = useRef<HTMLDivElement>(null)
  // YouTube's sound can't be heard here (setting off, capture refused): said under the bars rather than a flat line.
  const youtube = usePlayer((s) => s.now?.via === 'youtube')
  const liveYoutube = useSettings((s) => s.settings.liveYoutube)
  const error = useLive((l) => l.error)
  const why = !youtube ? undefined : !liveYoutube ? tr('YouTube’s sound isn’t listened to: turn on “Process YouTube’s sound” in Settings › Playback') : error && tr('Not on this video: {error}. It plays as usual.', { error })
  useEffect(() => {
    const bars = [...(ref.current?.children ?? [])] as HTMLElement[]
    let heights: number[] = new Array(BARS).fill(0)
    const shown: number[] = new Array(BARS).fill(-1)
    let last = performance.now()
    let id = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      heights = stepBars(heights, usePlayer.getState().playing ? useLive.getState().levels?.bands : undefined, dt)
      heights.forEach((h, i) => {
        // Unchanged to the eye: no style write.
        const v = Math.max(FLOOR, Math.round(h * 200) / 200)
        if (v !== shown[i]) bars[i].style.transform = `scaleY(${(shown[i] = v)})`
      })
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div ref={ref} aria-hidden className="flex h-12 w-full items-end gap-1">
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} className="h-full flex-1 origin-bottom rounded-sm bg-accent will-change-transform" style={{ transform: `scaleY(${FLOOR})` }} />
        ))}
      </div>
      {why && <p className="text-center text-[0.6875rem] text-ink-3">{why}</p>}
    </div>
  )
}
