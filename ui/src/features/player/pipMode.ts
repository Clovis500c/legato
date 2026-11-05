import { create } from 'zustand'
import { preloadPip } from '../../app/pages'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { phoneApp } from '../../shared/platform'
import { useCoverFull } from './coverFull'
import { useKaraoke } from './karaokeMode'
import { usePlayer } from './store'
import { useVizFull } from './vizFull'
import { vizFullKeys } from './vizFullKeys'

/**
 * Picture-in-picture (PipScreen.tsx, loaded when first opened): the window small and above the others (Rust `pip.rs`),
 * the video or the cover, a strip of controls. Only its slot holds the video then (VideoSlot). Esc or its button: back
 * to the window as it was; its place is kept (settings `pipPlace`, this PC only). Not from the full screens (their keys
 * wait for Esc) nor on the phone.
 */
export const usePip = create<{ on: boolean }>(() => ({ on: false }))

let unkey: (() => void) | undefined
// A change on its way: a second press waits for it.
let busy = false

export async function openPip() {
  if (phoneApp || busy || usePip.getState().on || !usePlayer.getState().now || useKaraoke.getState().open || useVizFull.getState().open || useCoverFull.getState().open) return
  busy = true
  try {
    // Drawn before the window shrinks: the picture shrinks with it, the app never shows at that size.
    await preloadPip().catch(() => {})
    usePip.setState({ on: true })
    // A field behind it (the search box) must not keep the keyboard.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    unkey = vizFullKeys(() => void closePip())
    await api.pip(true, useSettings.getState().settings.pipPlace)
  } catch {
    // Window left as it was: the screen goes too.
    unkey?.()
    unkey = undefined
    usePip.setState({ on: false })
  } finally {
    busy = false
  }
}

export async function closePip() {
  if (busy || !usePip.getState().on) return
  busy = true
  unkey?.()
  unkey = undefined
  try {
    // The window grows back first, the picture with it; then the app.
    const place = await api.pip(false, null)
    if (place) useSettings.getState().update({ pipPlace: place })
  } catch {
    // Back on screen anyway: the app under it shows.
  } finally {
    usePip.setState({ on: false })
    busy = false
  }
}

export const togglePip = () => void (usePip.getState().on ? closePip() : openPip())
