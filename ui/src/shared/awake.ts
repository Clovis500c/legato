import { useEffect, useRef } from 'react'

/** What a screen wake lock needs: fakes in tests, the page's own by default (`pageAwake`). */
export interface AwakeEnv {
  /** null: no Wake Lock API here (the setting's row hides). */
  request: (() => Promise<Lock>) | null
  visible: () => boolean
  /** Called on every visibility change; returns its remover. */
  onVisibility: (f: () => void) => () => void
}

interface Lock {
  readonly released: boolean
  release(): Promise<void>
}

export interface Awake {
  set(on: boolean): void
  dispose(): void
}

/**
 * Screen kept on while wanted. The browser drops the lock when the page hides (minimized, tray), so it is taken again
 * when the page shows; one request at a time, a late one let go when no longer wanted.
 */
export function makeAwake(env: AwakeEnv): Awake {
  let want = false
  let gone = false
  let asking = false
  let lock: Lock | undefined
  const drop = () => {
    const l = lock
    lock = undefined
    void l?.release().catch(() => {})
  }
  const take = () => {
    if (!want || gone || asking || !env.request || !env.visible() || (lock && !lock.released)) return
    asking = true
    env.request().then(
      (l) => {
        asking = false
        if (want && !gone) lock = l
        else void l.release().catch(() => {})
      },
      () => {
        asking = false
      },
    )
  }
  const off = env.onVisibility(take)
  return {
    set(on) {
      want = on
      if (on) take()
      else drop()
    },
    dispose() {
      gone = true
      want = false
      off()
      drop()
    },
  }
}

/** The page's Wake Lock API (WebView2 has it; a WebView without it gets `request: null`). */
export function pageAwake(): AwakeEnv {
  const wl = typeof navigator !== 'undefined' && 'wakeLock' in navigator ? navigator.wakeLock : null
  return {
    request: wl ? () => wl.request('screen') : null,
    visible: () => document.visibilityState === 'visible',
    onVisibility: (f) => {
      document.addEventListener('visibilitychange', f)
      return () => document.removeEventListener('visibilitychange', f)
    },
  }
}

/** True when this page can keep the screen on. */
export const canKeepAwake = (): boolean => typeof navigator !== 'undefined' && 'wakeLock' in navigator

/** Screen kept on while `on` and the component is mounted. */
export function useAwake(on: boolean): void {
  const awake = useRef<Awake | null>(null)
  useEffect(() => {
    const a = makeAwake(pageAwake())
    awake.current = a
    return () => {
      a.dispose()
      awake.current = null
    }
  }, [])
  useEffect(() => awake.current?.set(on), [on])
}
