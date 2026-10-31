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
  const w = getCurrentWindow()
  try {
    if (!(await w.isFullscreen())) {
      await w.setFullscreen(true)
      entered = true
    }
    // Closed while the window was changing: give it back.
    if (!useKaraoke.getState().open) return leave()
    const off = await w.onResized(() => {
      void w.isFullscreen().then((on) => {
        if (!on) {
          entered = false
          closeKaraoke()
        }
      }, () => {})
    })
    if (useKaraoke.getState().open) unlisten = off
    else off()
  } catch {
    // No full screen (a failure): the screen still covers the window.
  }
}

function leave() {
  unlisten?.()
  unlisten = undefined
  if (entered) {
    entered = false
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
  unkey?.()
  unkey = undefined
  leave()
}

export const toggleKaraoke = () => (useKaraoke.getState().open ? closeKaraoke() : openKaraoke())
