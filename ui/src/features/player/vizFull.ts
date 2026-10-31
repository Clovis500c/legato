import { create } from 'zustand'
import { holdFullscreen } from '../../app/fullscreen'
import { usePlayer } from './store'
import { vizFullKeys } from './vizFullKeys'

/**
 * The visualizer full screen (VizScreen.tsx, loaded when first opened): the window in full screen, the music drawn
 * over all of it. State and keys live here, in the first chunk, so Esc works even while the screen is still loading.
 * Not offered while Spotify plays (its sound is in its own app: nothing to draw).
 */
export const useVizFull = create<{ open: boolean }>(() => ({ open: false }))

const screen = holdFullscreen('viz-fullscreen', () => useVizFull.getState().open, () => closeVizFull())
screen.restore()
let unkey: (() => void) | undefined

/** Can the screen open now: something plays (or is queued) that the app can hear. */
export const canVizFull = () => {
  const via = usePlayer.getState().now?.via
  return !!via && via !== 'spotify'
}

export function openVizFull() {
  if (useVizFull.getState().open || !canVizFull()) return
  useVizFull.setState({ open: true })
  unkey = vizFullKeys(closeVizFull)
  void screen.enter()
}

export function closeVizFull() {
  if (!useVizFull.getState().open) return
  useVizFull.setState({ open: false })
  unkey?.()
  unkey = undefined
  screen.leave()
}

export const toggleVizFull = () => (useVizFull.getState().open ? closeVizFull() : openVizFull())
