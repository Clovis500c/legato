import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type YtmAccount } from '../../shared/api'

/**
 * Google accounts signed in for YouTube Music, and the sign-in window: while it's open, checked every 2 s (it closes
 * itself once signed in); a new account brings its playlists in right away. Settings › Accounts and the welcome.
 */
export function useGoogleAccounts() {
  const sync = useStore((s) => s.sync)
  const [data, setData] = useState<{ signedIn: boolean; accounts: YtmAccount[]; picked: string[] }>()
  const [waiting, setWaiting] = useState(false)
  const load = useCallback(
    () =>
      api
        .ytmAccounts()
        .then((d) => {
          setData(d)
          return d
        })
        .catch((e) => {
          useStore.setState({ error: String(e) })
          return undefined
        }),
    [],
  )
  useEffect(() => void load(), [load])
  // Sign-in window open: watch for the session (window closes itself once signed in).
  useEffect(() => {
    if (!waiting) return
    const before = data?.accounts.length ?? 0
    const id = setInterval(async () => {
      const d = await load()
      if (d?.signedIn && d.accounts.length > before) {
        setWaiting(false)
        // Signed in: playlists come in right away, no extra step.
        void sync()
      }
    }, 2000)
    return () => clearInterval(id)
  }, [waiting, load, sync, data?.accounts.length])

  const signIn = (add: boolean) => {
    setWaiting(true)
    api.ytmSignIn(add).catch((e) => useStore.setState({ error: String(e) }))
  }
  return { data, waiting, load, signIn }
}
