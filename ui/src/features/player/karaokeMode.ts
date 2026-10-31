import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { songKey } from './effects'
import { karaokeKeys } from './karaokeKeys'
import { fixesWith, NO_FIX, type LyricsFix } from './lyricsAt'
import { nudged } from './karaokeLines'
import { usePlayer } from './store'

/**
 * Karaoke mode (Karaoke.tsx, loaded when first opened): the window in full screen, the lyrics big over the blurred
 * cover. State and keys live here, in the first chunk, so Esc and K work even while the screen is still loading.
 */
export const useKaraoke = create<{ open: boolean }>(() => ({ open: false }))

// Full screen put on by us (given back on leaving), and the listener that sees it left by another way (F11, title bar).
let entered = false
let unlisten: (() => void) | undefined
let unkey: (() => void) | undefined
// Bumped at each open and close: a slow enter that finds itself superseded does nothing more.
let gen = 0

// Kept in sessionStorage too: a page reload while open loses the module state, the window would stay full screen.
const FLAG = 'karaoke-fullscreen'
function mark(on: boolean) {
  entered = on
  try {
    if (on) sessionStorage.setItem(FLAG, '1')
    else sessionStorage.removeItem(FLAG)
  } catch {
    // No storage: only a reload while open stays full screen.
  }
}

/** At start: full screen left by a page that reloaded with karaoke open is given back. */
export function restoreScreen() {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem(FLAG)) return
    sessionStorage.removeItem(FLAG)
    void getCurrentWindow().setFullscreen(false).catch(() => {})
  } catch {
    // No storage: nothing to give back.
  }
}
restoreScreen()

/** Lyrics fix of the song playing now (the same one the lyrics panel shows, saved the same way). */
export const nowFix = (): LyricsFix => {
  const song = songKey(usePlayer.getState().now)
  return (song && useSettings.getState().settings.lyricsSync[song]) || NO_FIX
}

/** Lyrics timing of the playing song moved by `ms`; null = back to none. */
export function nudgeLyrics(ms: number | null) {
  const song = songKey(usePlayer.getState().now)
  if (!song) return
  const fix = ms === null ? null : nudged(nowFix(), ms)
  useSettings.getState().update({ lyricsSync: fixesWith(useSettings.getState().settings.lyricsSync, song, fix) })
}

async function enter() {
  const mine = ++gen
  const w = getCurrentWindow()
  // Superseded (closed, maybe opened again): closed for good = full screen given back, else the newer enter owns it.
  const stale = () => {
    if (mine === gen) return false
    if (!useKaraoke.getState().open) leave()
    return true
  }
  try {
    if (!(await w.isFullscreen())) {
      await w.setFullscreen(true)
      mark(true)
    }
    if (stale()) return
    const off = await w.onResized(() => {
      void w.isFullscreen().then((on) => {
        if (!on) {
          mark(false)
          closeKaraoke()
        }
      }, () => {})
    })
    if (stale()) return off()
    unlisten?.()
    unlisten = off
  } catch {
    // No full screen (a failure): the screen still covers the window.
  }
}

function leave() {
  unlisten?.()
  unlisten = undefined
  if (entered) {
    mark(false)
    void getCurrentWindow().setFullscreen(false).catch(() => {})
  }
}

export function openKaraoke() {
  if (useKaraoke.getState().open || !usePlayer.getState().now) return
  useKaraoke.setState({ open: true })
  unkey = karaokeKeys(closeKaraoke, nudgeLyrics)
  void enter()
}

export function closeKaraoke() {
  if (!useKaraoke.getState().open) return
  useKaraoke.setState({ open: false })
  gen++
  unkey?.()
  unkey = undefined
  leave()
}

export const toggleKaraoke = () => (useKaraoke.getState().open ? closeKaraoke() : openKaraoke())
