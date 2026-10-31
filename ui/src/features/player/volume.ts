import { create } from 'zustand'
import { usePlayer } from './store'
import { nudged, wheelDelta, wheelVolume } from './volumeWheel'

/** The number shown while the volume changes by wheel or keys: when it last changed. */
export const useVolumeHud = create<{ at: number }>(() => ({ at: 0 }))

/** Volume by a change (0.01 = 1 %), with the number shown. */
export function nudgeVolume(delta: number): void {
  const p = usePlayer.getState()
  p.setVolume(nudged(p.volume, delta))
  useVolumeHud.setState({ at: Date.now() })
}

/**
 * Ref callback for a player's own area: the wheel there changes the volume. Non-passive, so the page does not scroll
 * under it. Only on areas without a list; a list keeps its wheel.
 */
export function volumeWheelRef(el: HTMLElement | null): (() => void) | void {
  if (!el) return
  let acc = 0
  const on = (e: WheelEvent) => {
    if (e.ctrlKey || !wheelDelta(e)) return
    e.preventDefault()
    const r = wheelVolume(acc, e)
    acc = r.acc
    if (r.delta) nudgeVolume(r.delta)
  }
  el.addEventListener('wheel', on, { passive: false })
  return () => el.removeEventListener('wheel', on)
}
