import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Profile } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'

/** Settings › General › Discord sign-in: the Discord page opens in the browser, the name comes back, the playlists shared from this PC carry it. */
export function DiscordSignIn() {
  const [me, setMe] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.discordLoginStatus().then(setMe, () => {})
  }, [])
  const signIn = () => {
    setBusy(true)
    api.discordLoginConnect().then(setMe, (e) => useStore.getState().notify(String(e), { kind: 'error' })).finally(() => setBusy(false))
  }
  const signOut = () => void api.discordLoginDisconnect().then(() => setMe(null), () => {})
  return me ? (
    <span className="flex items-center gap-2 text-sm">
      {tr('Signed in as {name}', { name: me.name })}
      <Button variant="ghost" onClick={signOut}>
        {tr('Sign out')}
      </Button>
    </span>
  ) : (
    <Button disabled={busy} onClick={signIn}>
      {busy ? tr('Waiting for Discord…') : tr('Sign in with Discord')}
    </Button>
  )
}
