import { DiscordLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type DiscordCard } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Led } from '../../shared/ui/controls'

/** The accent Discord keeps for an account with no banner, as CSS. */
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/** A picture from Discord's CDN through the `art` scheme; any failure (offline, a removed picture) shows `fallback`. */
function Picture({ url, className, fallback }: { url: string | null; className: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  return url && !failed ? <img src={remoteArt(url)} alt="" draggable={false} onError={() => setFailed(true)} className={className} /> : <>{fallback}</>
}

/** Discord's profile card, the way Discord draws it: the banner on top (the accent colour when there is none), the round picture overlapping, the name. */
function Card({ card, onSignOut }: { card: DiscordCard; onSignOut: () => void }) {
  const initial = Array.from(card.name.trim())[0]?.toUpperCase() ?? '?'
  const plain = card.accent === null ? undefined : hex(card.accent)
  return (
    <div className="ms-13 @max-lg:ms-0 overflow-hidden rounded-xl border border-line bg-bg" data-testid="discord-card">
      <div className="h-24 w-full bg-linear-to-br from-accent/60 to-raised" style={plain ? { background: plain } : undefined}>
        <Picture url={card.banner} className="size-full object-cover" fallback={null} />
      </div>
      <div className="flex items-end gap-3 px-4 pb-3.5">
        <span className="-mt-9 grid size-[4.5rem] shrink-0 place-items-center overflow-hidden rounded-full border-4 border-bg bg-raised text-xl font-bold text-ink-2">
          <Picture url={card.avatar} className="size-full object-cover" fallback={initial} />
        </span>
        <div className="min-w-0 flex-1 pb-0.5">
          <p className="truncate text-sm font-semibold">{card.name}</p>
          <p className="text-xs text-ink-2">{tr('Signed in with Discord')}</p>
        </div>
        <Button variant="ghost" onClick={onSignOut}>
          {tr('Sign out')}
        </Button>
      </div>
    </div>
  )
}

/** Settings › Accounts › Discord: off by default (Settings › General turns it on); signed in, the profile card. */
export function DiscordAccount() {
  const on = useSettings((s) => s.settings.discordSignIn)
  const update = useSettings((s) => s.update)
  const [card, setCard] = useState<DiscordCard | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (on) void api.discordLoginStatus().then(setCard, () => {})
    else setCard(null)
  }, [on])
  const signIn = () => {
    setBusy(true)
    api.discordLoginConnect().then(setCard, (e) => useStore.getState().notify(String(e), { kind: 'error' })).finally(() => setBusy(false))
  }
  const signOut = () => void api.discordLoginDisconnect().then(() => setCard(null), () => {})
  return (
    <div data-setting="Discord sign-in" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <div className="flex items-center gap-4 @max-lg:flex-wrap @max-lg:gap-x-3 @max-lg:gap-y-2">
        <Led on={!!card} />
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-2">
          <DiscordLogo size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[0.8125rem] font-semibold">Discord</p>
          <p className="text-xs text-ink-2">{tr('Optional. Your name and picture, and the playlists you share say who shared them. Never your e-mail or your servers.')}</p>
        </div>
        <div className="flex items-center gap-4 @max-lg:w-full @max-lg:ps-[4.125rem]">
          <span className="kicker">{card ? tr('Connected') : on ? tr('Not connected') : tr('Off')}</span>
          {!card && on && (
            <Button disabled={busy} onClick={signIn}>
              {busy ? tr('Waiting for Discord…') : tr('Sign in with Discord')}
            </Button>
          )}
          {!on && <Button onClick={() => update({ discordSignIn: true })}>{tr('Turn on')}</Button>}
        </div>
      </div>
      {card && <Card card={card} onSignOut={signOut} />}
    </div>
  )
}
