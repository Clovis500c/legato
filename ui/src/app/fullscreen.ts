import { getCurrentWindow } from '@tauri-apps/api/window'

/** Full screen on / off (F11, title bar button). */
export async function toggleFullscreen() {
  const w = getCurrentWindow()
  await w.setFullscreen(!(await w.isFullscreen()))
}

/**
 * A screen that takes the window full screen while it is open (the visualizer's, like karaoke's): `enter` puts it on if it
 * was not, and watches for it being left another way (F11, title bar), which calls `onLeft`; `leave` gives back only what
 * `enter` took. The state is kept in sessionStorage under `flag` too: a page reload while open forgets the module, the
 * window would stay full screen, so `restore` (call it at start) gives it back.
 */
export function holdFullscreen(flag: string, isOpen: () => boolean, onLeft: () => void) {
  let entered = false
  let unlisten: (() => void) | undefined
  // Bumped at each enter and leave: a slow enter that finds itself superseded does nothing more.
  let gen = 0
  const mark = (on: boolean) => {
    entered = on
    try {
      if (on) sessionStorage.setItem(flag, '1')
      else sessionStorage.removeItem(flag)
    } catch {
      // No storage: only a reload while open stays full screen.
    }
  }
  const give = () => {
    unlisten?.()
    unlisten = undefined
    if (entered) {
      mark(false)
      void getCurrentWindow().setFullscreen(false).catch(() => {})
    }
  }
  return {
    async enter() {
      const mine = ++gen
      const w = getCurrentWindow()
      // Superseded: closed for good = full screen given back, else the newer enter owns it.
      const stale = () => {
        if (mine === gen) return false
        if (!isOpen()) give()
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
              onLeft()
            }
          }, () => {})
        })
        if (stale()) return off()
        unlisten?.()
        unlisten = off
      } catch {
        // No full screen (a failure): the screen still covers the window.
      }
    },
    leave() {
      gen++
      give()
    },
    /** At start: full screen left by a page that reloaded while open is given back. */
    restore() {
      try {
        if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem(flag)) return
        sessionStorage.removeItem(flag)
        void getCurrentWindow().setFullscreen(false).catch(() => {})
      } catch {
        // No storage: nothing to give back.
      }
    },
  }
}
