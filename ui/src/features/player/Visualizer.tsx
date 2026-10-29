import { useEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { useLive } from './live'
import { usePlayer } from './store'
import { BARS, stepBars, stepPeaks, wavePath } from './bars'

const FLOOR = 0.04
/** Box height, px (h-12): peaks are placed in px. Wave: drawn in a 160 × 48 box, stretched. */
const H = 48
const W = 160

/**
 * The music under the cover (Settings › Playback › Visualizer), in one of four looks: bars from the bottom, bars
 * mirrored from the middle, bars with falling peaks, a wave. Transform / one path per frame, no layout.
 */
export function Visualizer() {
  const ref = useRef<HTMLDivElement>(null)
  const look = useSettings((s) => s.settings.visualizerStyle)
  // YouTube's sound can't be heard here (setting off, capture refused): said under the bars rather than a flat line.
  const youtube = usePlayer((s) => s.now?.via === 'youtube')
  const liveYoutube = useSettings((s) => s.settings.liveYoutube)
  const error = useLive((l) => l.error)
  const why = !youtube ? undefined : !liveYoutube ? tr('YouTube’s sound isn’t listened to: turn on “Process YouTube’s sound” in Settings › Playback') : error && tr('Not on this video: {error}. It plays as usual.', { error })
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const bars = [...box.querySelectorAll<HTMLElement>('[data-bar]')]
    const caps = [...box.querySelectorAll<HTMLElement>('[data-cap]')]
    const wave = box.querySelector<SVGPathElement>('[data-wave]')
    const line = box.querySelector<SVGPathElement>('[data-line]')
    let heights: number[] = new Array(BARS).fill(0)
    let peaks: number[] = new Array(BARS).fill(0)
    const shown: number[] = new Array(BARS).fill(-1)
    const capShown: number[] = new Array(BARS).fill(-1)
    let last = performance.now()
    let id = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      heights = stepBars(heights, usePlayer.getState().playing ? useLive.getState().levels?.bands : undefined, dt)
      if (wave && line) {
        wave.setAttribute('d', wavePath(heights, W, H, true))
        line.setAttribute('d', wavePath(heights, W, H, false))
      } else {
        heights.forEach((h, i) => {
          // Unchanged to the eye: no style write.
          const v = Math.max(FLOOR, Math.round(h * 200) / 200)
          if (v !== shown[i]) bars[i].style.transform = `scaleY(${(shown[i] = v)})`
        })
      }
      if (caps.length) {
        peaks = stepPeaks(peaks, heights, dt)
        peaks.forEach((p, i) => {
          const y = Math.round(p * (H - 2))
          if (y !== capShown[i]) caps[i].style.transform = `translateY(${-(capShown[i] = y)}px)`
        })
      }
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [look])
  const cols = Array.from({ length: BARS }, (_, i) => i)
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div ref={ref} aria-hidden className={`flex h-12 w-full gap-1 ${look === 'mirror' ? 'items-center' : 'items-end'}`}>
        {look === 'wave' ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full overflow-visible">
            <path data-wave className="fill-accent opacity-25" />
            <path data-line className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        ) : (
          cols.map((i) => (
            <span key={i} className="relative h-full flex-1">
              <span data-bar className={`absolute inset-0 rounded-sm bg-accent will-change-transform ${look === 'mirror' ? 'origin-center' : 'origin-bottom'}`} style={{ transform: `scaleY(${FLOOR})` }} />
              {look === 'peaks' && <span data-cap className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink will-change-transform" />}
            </span>
          ))
        )}
      </div>
      {why && <p className="text-center text-[0.6875rem] text-ink-3">{why}</p>}
    </div>
  )
}
