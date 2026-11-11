import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { preloadPip } from '../../app/pages'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { phoneApp } from '../../shared/platform'
import { useCoverFull } from './coverFull'
import { useKaraoke } from './karaokeMode'
import { minimizeStep } from './pipMinimize'
import { usePlayer } from './store'
import { useVizFull } from './vizFull'
import { vizFullKeys } from './vizFullKeys'

/**
 * Picture-in-picture (PipScreen.tsx, loaded when first opened): the window small and above the others (Rust `pip.rs`),
 * the video or the cover, a strip of controls. Only its slot holds the video then (VideoSlot). Esc or its button: back
 * to the window as it was; its place is kept (settings `pipPlace`, this PC only). Not from the full screens (their keys
 * wait for Esc) nor on the phone.
 */
export const usePip = create<{ on: boolean; classic: boolean }>(() => ({ on: false, classic: false }))

// shortcut: the classic strip's place is kept for this run only (pipPlace holds the picture's size); a setting if missed.
let classicPlace: [number, number, number, number] | null = null

let unkey: (() => void) | undefined
// A change on its way: a second press waits for it.
let busy = false
// Opened by a minimize (settings `pipOnMinimize`); `hidden`: minimized in turn, so a restore gives the full window.
let fromMinimize = false
let hidden = false

/** `minimized`: opened instead of a minimize. */
export async function openPip(minimized = false) {
  if (phoneApp || busy || usePip.getState().on || !usePlayer.getState().now || useKaraoke.getState().open || useVizFull.getState().open || useCoverFull.getState().open) return
  busy = true
  try {
    // Drawn before the window shrinks: the picture shrinks with it, the app never shows at that size.
    await preloadPip().catch(() => {})
    const { pipPlace, pipClassic: classic } = useSettings.getState().settings
    usePip.setState({ on: true, classic })
    // A field behind it (the search box) must not keep the keyboard.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    unkey = vizFullKeys(() => void closePip())
    await api.pip(true, classic ? classicPlace : pipPlace, classic)
    fromMinimize = minimized
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
    if (place && usePip.getState().classic) classicPlace = place
    else if (place) useSettings.getState().update({ pipPlace: place })
  } catch {
    // Back on screen anyway: the app under it shows.
  } finally {
    usePip.setState({ on: false })
    fromMinimize = hidden = false
    busy = false
  }
}

export const togglePip = () => void (usePip.getState().on ? closePip() : openPip())

/** Settings › General › Picture-in-picture on minimize: on, and a song playing. */
const pipOnMinimize = () => !phoneApp && useSettings.getState().settings.pipOnMinimize && usePlayer.getState().playing

/** The title bar's minimize: picture in picture instead when the setting says so (no minimize to undo first). */
export function minimizeWindow() {
  const win = getCurrentWindow()
  if (!pipOnMinimize() || usePip.getState().on) return void win.minimize()
  // Refused (a full screen open, a change on its way): Windows' minimize after all.
  void openPip(true).then(() => {
    if (!usePip.getState().on) void win.minimize()
  })
}

/**
 * Windows' own minimize (Win+Down, the taskbar, Win+M) while a song plays: picture in picture instead (`pip.rs` brings the
 * window back first). That small window minimized, then restored from the taskbar: the full window again. Picture in
 * picture opened by P minimizes and comes back as before.
 */
export function watchMinimize(): () => void {
  if (phoneApp) return () => {}
  const win = getCurrentWindow()
  let minimized = false
  const off = win.onResized(async ({ payload }) => {
    // Minimized, Windows' window is 0 × 0: only then, and on the way back, is the window asked.
    if (!minimized && (payload.width || payload.height)) return
    const now = await win.isMinimized().catch(() => false)
    const step = minimizeStep({ was: minimized, now, pip: usePip.getState().on, fromMinimize, hidden, wanted: pipOnMinimize() })
    minimized = now
    hidden = step.hidden
    if (step.act === 'open') void openPip(true)
    else if (step.act === 'close') void closePip()
  })
  return () => void off.then((f) => f())
}
