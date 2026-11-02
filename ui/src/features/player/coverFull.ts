import { create } from 'zustand'
import { holdFullscreen } from '../../app/fullscreen'
import { usePlayer } from './store'
import { vizFullKeys } from './vizFullKeys'

/**
 * The cover display (CoverScreen.tsx, loaded when first opened): the window in full screen, the cover huge over its own
 * blurred copy, title and progress on it, a clock if asked (settings `coverClock`). A picture for a second screen.
 * State and keys live here, in the first chunk, so Esc works even while the screen is still loading (the visualizer's).
 */
export const useCoverFull = create<{ open: boolean }>(() => ({ open: false }))

const screen = holdFullscreen('cover-fullscreen', () => useCoverFull.getState().open, () => closeCoverFull())
screen.restore()
let unkey: (() => void) | undefined

export function openCoverFull() {
  if (useCoverFull.getState().open || !usePlayer.getState().now) return
  useCoverFull.setState({ open: true })
  // A field behind the screen (the search box) must not keep the keyboard.
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  unkey = vizFullKeys(closeCoverFull)
  void screen.enter()
}

export function closeCoverFull() {
  if (!useCoverFull.getState().open) return
  useCoverFull.setState({ open: false })
  unkey?.()
  unkey = undefined
  screen.leave()
}

export const toggleCoverFull = () => (useCoverFull.getState().open ? closeCoverFull() : openCoverFull())
