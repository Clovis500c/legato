import { useEffect, type RefObject } from 'react'
import { punch, useLive } from './live'
import { usePlayer } from './store'

/** Biggest growth, on the hardest hit. */
const SCALE = 0.045

/** Next pulse value: up fast, down slower (hits show, the cover doesn't flutter). dt in seconds. */
export function follow(e: number, target: number, dt: number): number {
  return e + (target - e) * (1 - Math.exp(-dt / (target > e ? 0.04 : 0.25)))
}

/**
 * The cover moves with the music (Settings › Advanced › Moving cover): swells on hits, settles when paused. Transform
 * only (no layout); none with reduced motion.
 */
export function usePulse(ref: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!on || !el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let e = 0
    let shown = -1
    let last = performance.now()
    let id = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      e = follow(e, usePlayer.getState().playing ? punch(useLive.getState().levels) : 0, dt)
      // Unchanged to the eye: no style write, no restyle.
      const scale = Math.round((1 + SCALE * e) * 2000) / 2000
      if (scale !== shown) el.style.transform = `scale(${(shown = scale)})`
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    el.style.willChange = 'transform'
    return () => {
      cancelAnimationFrame(id)
      el.style.transform = ''
      el.style.willChange = ''
    }
  }, [ref, on])
}
