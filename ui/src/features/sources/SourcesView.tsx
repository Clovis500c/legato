import { ArrowsClockwise, DeviceMobile, FolderPlus, GoogleLogo, HardDrives, ShieldCheck, SignOut, SpinnerGap, UserPlus, Warning, X } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { AppleImport } from '../add/AppleConnect'
import { openAppInfo } from '../add/phoneMic'
import { MUSIC_REFUSED, phoneFolders, withPhone } from '../add/phoneMusic'
import { SpotifyImport } from '../add/SpotifyConnect'
import { accountKey, api, type Direction, type PlexPin, type PlexServer, type ServerExposure, type ServerKind, type ServerStatus, type YtmAccount } from '../../shared/api'
import { useGoogleAccounts } from './google'
import { timeAgo } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { remoteArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { phoneApp } from '../../shared/platform'
import { ask } from '../../shared/ui/Ask'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useLastfm } from './lastfm'
import { useListenbrainz } from './listenbrainz'
import { syncServer, useServers } from './servers'
import { explain } from '../../shared/errors'

/** Each account's sync direction (user's request 2026-10-29), kept in Rust (music_core::sync). */
function useDirections() {
  const [dirs, setDirs] = useState<Record<string, Direction>>({})
  useEffect(() => void api.syncDirections().then(setDirs, () => {}), [])
  const set = (key: string, d: Direction) => {
    setDirs((m) => ({ ...m, [key]: d }))
    api.setSyncDirection(key, d).catch((e) => useStore.setState({ error: String(e) }))
  }
  return [dirs, set] as const
}

const directionHelp: Record<Direction, string> = {
  both: msg('Its playlists and likes come in; your likes, adds and removals here go out to {service}.'),
  pull: msg('Its playlists and likes come in. Nothing made here goes out: your likes stay in your own Liked Music.'),
  push: msg('Your likes, adds and removals here go out to {service}. Nothing new comes in from it.'),
  off: msg('Nothing comes in or goes out. What was imported stays.'),
}

/** Spotify: nothing comes back to it, so its likes go further by YouTube Music's direction only. */
// Your music server: songs and stars come in, likes and plays go out (playlist edits stay here for now).
const serverHelp: Record<Direction, string> = {
  both: msg('Its songs, playlists and stars come in; your likes and plays here go out to your music server.'),
  pull: msg('Its songs, playlists and stars come in. Nothing goes back: your likes and plays stay here.'),
  push: msg('Your likes and plays here go out to your music server. Nothing new comes in from it.'),
  off: directionHelp.off,
}

const pullOnly = msg('Its playlists and likes come in. Nothing goes back to Spotify; YouTube Music’s own direction decides what reaches it.')

/** Spotify: playlists come in only (sending to Spotify isn't built: no Premium account to test it on). */
function DirectionPicker({ service, value, onChange, receives = true, help = directionHelp }: { service: string; value: Direction; onChange: (d: Direction) => void; receives?: boolean; help?: Record<Direction, string> }) {
  const all: { value: Direction; label: string }[] = [
    { value: 'both', label: tr('Both ways') },
    { value: 'pull', label: tr('Import only') },
    { value: 'push', label: tr('Send only') },
    { value: 'off', label: tr('Off') },
  ]
  const options = receives ? all : all.filter((o) => o.value === 'pull' || o.value === 'off')
  const shown = receives || value === 'off' ? value : 'pull'
  return (
    <div data-setting="Sync direction" className="flex flex-col gap-1.5">
      <Segmented label={tr('Sync direction')} value={shown} onChange={onChange} options={options} />
      <p className="text-xs text-ink-2">{tr(!receives && shown === 'pull' ? pullOnly : help[shown], { service })}</p>
    </div>
  )
}

/**
 * An account's first line: its light and icon, its name and what it does, then its state and buttons. A narrow pane (the
 * phone, a small window) puts the state and buttons under the words: beside them, the words got one per line.
 */
function AccountLine({ on, icon, title, pitch, state, children }: { on: boolean; icon: ReactNode; title: ReactNode; pitch: ReactNode; state: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 @max-lg:flex-wrap @max-lg:gap-x-3 @max-lg:gap-y-2">
      <Led on={on} />
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-2">{icon}</span>
      <div className="flex-1">
        <p className="text-[0.8125rem] font-semibold">{title}</p>
        <p className="text-xs text-ink-2">{pitch}</p>
      </div>
      <div className="flex items-center gap-4 @max-lg:w-full @max-lg:flex-wrap @max-lg:gap-x-3 @max-lg:gap-y-2 @max-lg:pl-[4.125rem]">
        <span className="kicker">{state}</span>
        {children}
      </div>
    </div>
  )
}

function ServiceRow({ service }: { service: 'spotify' }) {
  const { status, disconnect, busy, go, view } = useStore(useShallow(({ status, disconnect, busy, go, view }) => ({ status, disconnect, busy, go, view })))
  const { connected } = status[service]
  const selected = view.name === 'settings' && view.wizard === service
  const [dirs, setDir] = useDirections()
  return (
    <div data-setting={sourceLabel[service]} className={`flex flex-col gap-3 border-b border-line-soft px-4 py-3.5 ${selected ? 'bg-bg' : ''}`}>
      <AccountLine on={connected} icon={<SourceIcon source={service} size={16} />} title={sourceLabel[service]} pitch={phoneApp && !connected ? tr('Connect it in Legato on your PC: your playlists come here when your devices sync.') : tr(guides[service].pitch)} state={connected ? tr('Connected') : tr('Not connected')}>
        {connected ? (
          <Button variant="ghost" disabled={busy} onClick={() => disconnect(service)}>
            {tr('Disconnect')}
          </Button>
        ) : (
          // The wizard's key comes from Spotify's dashboard, its sign-in back through this device's loopback: the PC's.
          !phoneApp && <Button onClick={() => go({ name: 'settings', section: 'sources', wizard: service })}>{tr('Connect')}</Button>
        )}
      </AccountLine>
      {connected && (
        <div className="ml-13 @max-lg:ml-0">
          <DirectionPicker service={sourceLabel[service]} value={dirs.spotify ?? 'both'} onChange={(d) => setDir('spotify', d)} receives={false} />
        </div>
      )}
    </div>
  )
}

/** Prototype: Spotify's official web player in a window, signed in on Spotify's page (no keys). Opening it imports nothing: the import is Connect Spotify's, offered here too, and follows the direction here. */
function SpotifyWeb() {
  const [on, setOn] = useState<boolean>()
  const [dirs, setDir] = useDirections()
  const keyed = useStore((s) => s.status.spotify.connected)
  useEffect(() => {
    const check = () => void api.spotifyWebStatus().then(setOn, () => setOn(false))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
  return (
    <div data-setting="Spotify web player" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <AccountLine
        on={!!on}
        icon={<SourceIcon source="spotify" size={16} />}
        title={
          <>
            {tr('Spotify web player')} <span className="kicker">{tr('Preview')}</span>
          </>
        }
        pitch={tr('Spotify’s own player in a window, signed in on Spotify’s page. Open only plays it: to bring your lists in, use Import my lists.')}
        state={on ? tr('Signed in') : tr('Not signed in')}
      >
        <Button variant="ghost" onClick={() => api.spotifyWebOpen().catch((e) => useStore.setState({ error: String(e) }))}>
          {tr('Open')}
        </Button>
        <SpotifyImport label={tr('Import my lists')} />
      </AccountLine>
      {/* With a key the row above shows it. */}
      {!keyed && (
        <div className="ml-13 @max-lg:ml-0">
          <DirectionPicker service="Spotify" value={dirs.spotify ?? 'both'} onChange={(d) => setDir('spotify', d)} receives={false} />
        </div>
      )}
    </div>
  )
}

/** Last.fm: your own free API key (last.fm/api), then you allow the app on last.fm. Listens go to your profile. */
/** Apple Music: its own page read for the playlists (Connect Apple Music); nothing plays there. */
function AppleWeb() {
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    const check = () => void api.appleWebStatus().then(setOn, () => setOn(false))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
  return (
    <div data-setting="Apple Music" className="border-b border-line-soft px-4 py-3.5">
      {/* Apple's page opens in a window: the phone shows it over the app with no way back. */}
      <AccountLine on={!!on} icon={<SourceIcon source="apple" size={16} />} title={tr('Apple Music')} pitch={phoneApp ? tr('Connect it in Legato on your PC: your playlists come here when your devices sync.') : tr('Your playlists are read on Apple Music’s own page, signed in there, and their songs play through YouTube.')} state={on ? tr('Signed in') : tr('Not signed in')}>
        {!phoneApp && <AppleImport label={tr('Import my lists')} />}
      </AccountLine>
    </div>
  )
}

function LastfmRow() {
  const { configured, user, waiting, refresh } = useLastfm()
  const [form, setForm] = useState(false)
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    try {
      const name = await api.lastfmConnect(key, secret)
      setForm(false)
      setKey('')
      setSecret('')
      useStore.getState().notify(tr('Scrobbling to Last.fm as {user}', { user: name }))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const disconnect = async () => {
    if (!(await ask({ title: tr('Stop scrobbling to Last.fm?'), body: (phoneApp ? tr('The key, secret and session are removed from this phone. Your Last.fm profile keeps what was sent.') : tr('The key, secret and session are removed from this PC. Your Last.fm profile keeps what was sent.')), ok: tr('Disconnect') }))) return
    await api.lastfmDisconnect().catch(() => {})
    void refresh()
  }
  const field = 'h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-xs'
  return (
    <div data-setting="Last.fm" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <AccountLine
        on={!!user}
        icon={<span className="text-xs font-bold">fm</span>}
        title="Last.fm"
        pitch={user ? tr('Every song you listen to goes to your profile (half of it or 4 minutes heard)') : tr('Scrobbling: your listens on your Last.fm profile, from every source. Free, with your own API key')}
        state={user ? (waiting ? tr('{user} · {n} waiting', { user, n: waiting }) : user) : configured ? tr('Signed out') : tr('Not connected')}
      >
        {user ? (
          <Button variant="ghost" onClick={() => void disconnect()}>
            {tr('Disconnect')}
          </Button>
        ) : (
          <Button onClick={() => setForm((f) => !f)}>{tr('Connect')}</Button>
        )}
      </AccountLine>
      {form && !user && (
        <div className="ml-13 @max-lg:ml-0 flex flex-col gap-2 rounded-lg border border-line bg-bg p-3 text-xs">
          <p className="text-ink-2">
            {tr('1. Create a free API account on last.fm (any name, no callback needed). 2. Paste its API key and shared secret. 3. Allow Legato on the page that opens.')}{' '}
            <button type="button" className="font-semibold text-ink underline" onClick={() => void openUrl('https://www.last.fm/api/account/create')}>
              last.fm/api/account/create
            </button>
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">{tr('API key')}</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">{tr('Shared secret')}</span>
            <input value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} type="password" className={field} />
          </label>
          <Button className="w-fit" disabled={busy || key.trim().length !== 32 || secret.trim().length !== 32} onClick={() => void connect()}>
            {busy ? tr('Waiting for Last.fm…') : tr('Allow on Last.fm')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** ListenBrainz: the user's token from its settings page, checked there; no key, no sign-in window. */
function ListenbrainzRow() {
  const { user, waiting, refresh } = useListenbrainz()
  const [form, setForm] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    try {
      const name = await api.listenbrainzConnect(token)
      setForm(false)
      setToken('')
      useStore.getState().notify(tr('Sending your listens to ListenBrainz as {user}', { user: name }))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const disconnect = async () => {
    if (!(await ask({ title: tr('Stop sending listens to ListenBrainz?'), body: (phoneApp ? tr('The token is removed from this phone. Your ListenBrainz profile keeps what was sent.') : tr('The token is removed from this PC. Your ListenBrainz profile keeps what was sent.')), ok: tr('Disconnect') }))) return
    await api.listenbrainzDisconnect().catch(() => {})
    void refresh()
  }
  return (
    <div data-setting="ListenBrainz" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <AccountLine
        on={!!user}
        icon={<span className="text-xs font-bold">LB</span>}
        title="ListenBrainz"
        pitch={user ? tr('Every song you listen to goes to your profile (half of it or 4 minutes heard)') : tr('Your listens on your ListenBrainz profile, from every source. Free and open, with your own token')}
        state={user ? (waiting ? tr('{user} · {n} waiting', { user, n: waiting }) : user) : tr('Not connected')}
      >
        {user ? (
          <Button variant="ghost" onClick={() => void disconnect()}>
            {tr('Disconnect')}
          </Button>
        ) : (
          <Button onClick={() => setForm((f) => !f)}>{tr('Connect')}</Button>
        )}
      </AccountLine>
      {form && !user && (
        <div className="ml-13 @max-lg:ml-0 flex flex-col gap-2 rounded-lg border border-line bg-bg p-3 text-xs">
          <p className="text-ink-2">
            {tr('Sign in on listenbrainz.org (free), copy the user token from its settings and paste it here.')}{' '}
            <button type="button" className="font-semibold text-ink underline" onClick={() => void openUrl('https://listenbrainz.org/settings/')}>
              listenbrainz.org/settings
            </button>
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">{tr('User token')}</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && token.trim().length >= 16 && void connect()} spellCheck={false} type="password" className="h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-xs" />
          </label>
          <Button className="w-fit" disabled={busy || token.trim().length < 16} onClick={() => void connect()}>
            {busy ? tr('Checking with ListenBrainz…') : tr('Connect')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** YouTube Music through a normal Google sign-in (like Pear Desktop): no keys. Several Google accounts / channels, pick which to sync. */
function GoogleAccounts() {
  const { refresh, sync, busy, lastSync } = useStore(useShallow(({ refresh, sync, busy, lastSync }) => ({ refresh, sync, busy, lastSync })))
  const { data, waiting, load, signIn } = useGoogleAccounts()
  const autoSync = useSettings((s) => s.settings.autoSync)
  const updateSettings = useSettings((s) => s.update)
  const [dirs, setDir] = useDirections()
  const toggle = async (a: YtmAccount, on: boolean) => {
    if (!data) return
    const keys = on ? [...data.picked, accountKey(a)] : data.picked.filter((k) => k !== accountKey(a))
    await api.setYtmAccounts(data.accounts.filter((x) => keys.includes(accountKey(x)))).catch((e) => useStore.setState({ error: String(e) }))
    await load()
  }
  const signOut = async () => {
    if (!(await ask({ title: tr('Sign out of Google?'), body: tr('Every Google account leaves Legato. Your library stays as it is.'), ok: tr('Sign out') }))) return
    await api.ytmSignOut().catch((e) => useStore.setState({ error: String(e) }))
    await load()
    void refresh()
  }

  return (
    <div data-setting="YouTube Music" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <AccountLine
        on={!!data?.signedIn}
        icon={<SourceIcon source="youtube" size={16} />}
        title="YouTube Music"
        pitch={data?.signedIn ? tr('Your playlists, search and export. No keys, no daily limit.') : phoneApp ? tr('Google refuses sign-ins inside phone apps: sign in in Legato on your PC, and your playlists come here when your devices sync.') : tr('Sign in with Google to import your YouTube Music playlists and Liked Music. No keys.')}
        state={data?.signedIn ? trn(data.accounts.length, '{n} account', '{n} accounts') : waiting ? tr('Waiting for Google…') : tr('Not signed in')}
      >
        {!data?.signedIn && !phoneApp && (
          <Button onClick={() => signIn(false)}>
            <GoogleLogo size={14} weight="bold" /> {tr('Sign in with Google')}
          </Button>
        )}
      </AccountLine>
      {data?.signedIn && (
        <>
          <ul className="ml-13 @max-lg:ml-0 flex flex-col rounded-lg border border-line-soft">
            {data.accounts.map((a) => {
              const on = data.picked.includes(accountKey(a))
              const first = data.picked[0] === accountKey(a)
              return (
                <li key={accountKey(a)} className="flex flex-col gap-2 border-b border-line-soft px-3 py-2 last:border-0">
                  <div className="flex items-center gap-3">
                    <Cover title={a.name} art={a.photo ? [remoteArt(a.photo)] : []} size={30} className="rounded-full!" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[0.8125rem] font-medium">
                        {a.name} {first && on && <span className="kicker">{tr('Exports here')}</span>}
                      </p>
                      <p className="truncate text-xs text-ink-2">{[a.handle, a.email, a.pageId && tr('channel')].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className="text-xs text-ink-2">{tr('Sync')}</span>
                    <Toggle label={tr('Sync {name}', { name: a.name })} checked={on} onChange={(v) => toggle(a, v)} />
                  </div>
                  {on && (
                    <div className="ml-[42px] @max-lg:ml-0">
                      <DirectionPicker service="YouTube Music" value={dirs[`youtube:${accountKey(a)}`] ?? 'both'} onChange={(d) => setDir(`youtube:${accountKey(a)}`, d)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="ml-13 @max-lg:ml-0 flex items-center gap-3 rounded-lg bg-recess px-3 py-2.5">
            <div className="flex-1">
              <p className="text-[0.8125rem] font-medium">{tr('Playlists and Liked Music')}</p>
              <p className="text-xs text-ink-2">{busy ? tr('Importing…') : lastSync ? tr('Last import {when}: {n} playlists', { when: timeAgo(lastSync.at), n: lastSync.report.playlists }) : tr('Imported when you sign in. Import again any time to pick up changes.')}</p>
            </div>
            <Button disabled={busy || !data.picked.length} onClick={() => void sync()}>
              <ArrowsClockwise size={14} className={busy ? 'animate-spin' : ''} /> {tr('Import playlists now')}
            </Button>
          </div>
          <div data-setting="Update every 15 minutes" className="ml-13 @max-lg:ml-0 flex items-center gap-3 px-3">
            <div className="flex-1">
              <p className="text-[0.8125rem] font-medium">{tr('Update every 15 minutes')}</p>
              <p className="text-xs text-ink-2">{tr('While the app is open, your playlists and Liked Music come in again by themselves. If Google limits this PC, it waits longer.')}</p>
            </div>
            <Toggle label={tr('Update every 15 minutes')} checked={autoSync} onChange={(on) => updateSettings({ autoSync: on })} />
          </div>
          <div className="ml-13 @max-lg:ml-0 flex gap-2">
            <Button variant="ghost" onClick={() => signIn(true)}>
              <UserPlus size={14} /> {waiting ? tr('Waiting for Google…') : tr('Add another Google account')}
            </Button>
            <Button variant="ghost" onClick={signOut}>
              <SignOut size={14} /> {tr('Sign out')}
            </Button>
          </div>
          <p className="ml-13 @max-lg:ml-0 text-xs text-ink-2">{tr('Synced accounts bring their playlists and Liked Music into your library. YouTube Music doesn’t offer an official way in without keys: this uses the site’s own access, like Pear Desktop, and may break if YouTube changes it.')}</p>
        </>
      )}
    </div>
  )
}

/** Plain http to a public address: said beside the address, and on the signed-in row. */
const OPEN_WARNING = msg('Plain http:// over the internet: your sign-in and your music travel unencrypted. Use your server’s https:// address if it has one.')

/** The host of a server's address, for its row. */
const hostOf = (address: string) => address.replace(/^https?:\/\//i, '')

/** One signed-in server: what came in, Sync now, Sign out, its sync direction. */
function ServerAccount({ s }: { s: ServerStatus }) {
  const syncing = useServers((x) => x.syncing === s.key)
  const [dirs, setDir] = useDirections()
  const sync = async () => {
    try {
      const done = await syncServer(s.key)
      useStore.getState().notify(trn(done.songs, '{n} song from your music server', '{n} songs from your music server'))
    } catch (e) {
      useStore.setState({ error: String(e) })
    }
  }
  const signOut = async () => {
    if (!(await ask({ title: tr('Sign out of your music server?'), body: phoneApp ? tr('Its songs and playlists leave your library on this phone. Your server keeps everything.') : tr('Its songs and playlists leave your library on this PC. Your server keeps everything.'), ok: tr('Sign out') }))) return
    await api.serverSignOut(s.key).catch((e) => useStore.setState({ error: String(e) }))
    await useStore.getState().refresh()
    void useServers.getState().refresh()
  }
  const state = syncing ? tr('Syncing…') : s.songs === null ? tr('Signed in') : trn(s.songs, '{n} song', '{n} songs')
  return (
    <>
      <AccountLine on icon={<HardDrives size={16} />} title={tr('Your music server')} pitch={`${s.user} · ${s.name ?? hostOf(s.address)}`} state={state}>
        <Button variant="ghost" disabled={syncing} onClick={() => void sync()}>
          <ArrowsClockwise size={14} /> {tr('Sync now')}
        </Button>
        <Button variant="ghost" disabled={syncing} onClick={() => void signOut()}>
          {tr('Sign out')}
        </Button>
      </AccountLine>
      <div className="ml-13 @max-lg:ml-0 flex flex-col gap-2 text-xs text-ink-2">
        {s.syncedAt !== null && <p>{s.playlists ? tr('Last sync {when} · {playlists}', { when: timeAgo(s.syncedAt), playlists: trn(s.playlists, '{n} playlist', '{n} playlists') }) : tr('Last sync {when}', { when: timeAgo(s.syncedAt) })}</p>}
        {s.error && <p className="text-ink">{explain(s.error).text}</p>}
        {s.relay && (
          <p className="flex items-start gap-1.5 text-ink">
            <Warning size={14} className="mt-px shrink-0" /> {tr('Through Plex’s relay: your server didn’t answer directly, so the music may come slower.')}
          </p>
        )}
        {s.exposure === 'open' && (
          <p className="flex items-start gap-1.5 text-ink">
            <Warning size={14} className="mt-px shrink-0" /> {tr(OPEN_WARNING)}
          </p>
        )}
        <DirectionPicker service={tr('your music server')} help={serverHelp} value={dirs[`server:${s.key}`] ?? 'both'} onChange={(d) => setDir(`server:${s.key}`, d)} />
      </div>
    </>
  )
}

/** Server kinds, as their own names say them. */
const SERVER_KINDS: { value: ServerKind; label: string }[] = [
  { value: 'subsonic', label: 'Subsonic' },
  { value: 'jellyfin', label: 'Jellyfin' },
  { value: 'plex', label: 'Plex' },
]

/** Sign in with Plex: Plex's own page in the browser (the password never comes here), its code shown while it waits,
 * then the server picked when the account has several. */
function PlexSignIn({ onSignedIn }: { onSignedIn: (s: ServerStatus) => Promise<void> }) {
  const [pin, setPin] = useState<PlexPin | null>(null)
  const [servers, setServers] = useState<PlexServer[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Leaving the form (or signing in) stops the wait.
  useEffect(() => () => void api.plexCancel().catch(() => {}), [])
  const pick = async (id: string) => {
    setBusy(tr('Finding your server…'))
    try {
      await onSignedIn(await api.plexPick(id))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(null)
    }
  }
  const [starting, setStarting] = useState(false)
  const start = async () => {
    // One sign-in at a time: a second click before the code came would make a second one.
    if (starting) return
    setServers(null)
    setStarting(true)
    try {
      const made = await api.plexSignIn()
      setStarting(false)
      setPin(made)
      const found = await api.plexWait()
      setPin(null)
      if (found.length === 1) return void (await pick(found[0].id))
      setServers(found)
    } catch (e) {
      setStarting(false)
      setPin(null)
      if (!/cancelled/.test(String(e))) useStore.setState({ error: String(e) })
    }
  }
  const cancel = () => {
    void api.plexCancel().catch(() => {})
    setPin(null)
    setServers(null)
  }
  if (pin)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-ink-2">{tr('Plex’s page is open in your browser: sign in there and allow Legato. It shows this code:')}</p>
        <p className="font-mono text-sm break-all text-ink">{pin.code}</p>
        <p className="flex items-center gap-1.5 text-ink-2">
          <SpinnerGap size={14} className="shrink-0 animate-spin" /> {tr('Waiting for you on Plex’s page…')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void openUrl(pin.authUrl).catch(() => {})}>
            {tr('Open Plex’s page again')}
          </Button>
          <Button variant="ghost" onClick={cancel}>
            {tr('Cancel')}
          </Button>
        </div>
      </div>
    )
  if (servers)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-ink-2">{tr('Which server?')}</p>
        <div className="flex flex-col gap-1.5">
          {servers.map((s) => (
            <button key={s.id} type="button" disabled={!!busy} onClick={() => void pick(s.id)} className="flex min-h-10 items-center gap-2.5 rounded-md border border-line px-3 py-2 text-left hover:bg-hover disabled:opacity-50">
              <HardDrives size={16} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
              {!s.owned && <span className="shrink-0 text-ink-2">{tr('Shared with you')}</span>}
            </button>
          ))}
        </div>
        {busy ? (
          <p className="flex items-center gap-1.5 text-ink-2">
            <SpinnerGap size={14} className="shrink-0 animate-spin" /> {busy}
          </p>
        ) : (
          <Button className="w-fit" variant="ghost" onClick={cancel}>
            {tr('Cancel')}
          </Button>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-1.5 text-ink-2">
        <ShieldCheck size={14} className="mt-px shrink-0" /> {phoneApp ? tr('You sign in on Plex’s own page, in your browser: Legato never sees your password. Your server’s access key stays in this phone’s secure storage.') : tr('You sign in on Plex’s own page, in your browser: Legato never sees your password. Your server’s access key stays in this PC’s keychain.')}
      </p>
      <Button className="w-fit" disabled={!!busy || starting} onClick={() => void start()}>
        {busy ?? tr('Sign in with Plex')}
      </Button>
    </div>
  )
}

/** Your music server: a Subsonic-compatible one (Navidrome, Airsonic, Gonic, Ampache), Jellyfin or Plex. Subsonic's
 * password goes to the keychain, Jellyfin's is used once for its token, Plex signs in on its own page; the first sync
 * follows. */
function ServerRow() {
  const { list, refresh } = useServers()
  const [form, setForm] = useState(false)
  const [kind, setKind] = useState<ServerKind>('subsonic')
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [exposure, setExposure] = useState<ServerExposure | null>(null)
  /** The server refused token sign-in (code 41) on an https address: the user may send the password as it is. */
  const [asPlain, setAsPlain] = useState(false)
  /** Its certificate refused by the system (self-signed): its fingerprint shown, then the one the user trusted. */
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [trusted, setTrusted] = useState<string>()
  useEffect(() => void refresh(), [refresh])
  useEffect(() => {
    setAsPlain(false)
    setFingerprint(null)
    setTrusted(undefined)
    if (!address.trim()) return setExposure(null)
    const t = setTimeout(() => void api.serverExposure(address).then(setExposure, () => setExposure(null)), 250)
    return () => clearTimeout(t)
  }, [address])
  const ready = !!address.trim() && !!user.trim() && !!password && !busy
  /** Signed in: the row shows it, then its first sync. */
  const signedIn = async (s: ServerStatus) => {
    setForm(false)
    setPassword('')
    await refresh()
    setBusy(tr('Syncing your server…'))
    try {
      const done = await syncServer(s.key)
      useStore.getState().notify(trn(done.songs, '{n} song from your music server', '{n} songs from your music server'))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(null)
      void refresh()
    }
  }
  const signIn = async (plain = false, pin = trusted) => {
    setBusy(tr('Checking with your server…'))
    try {
      const s = await api.serverSignIn(kind, address, user, password, plain, pin)
      setBusy(null)
      await signedIn(s)
    } catch (e) {
      setBusy(null)
      // Code 41 on https: asked here, with its warning, instead of an error toast.
      if (!plain && kind === 'subsonic' && /only takes the password sent as it is/.test(String(e)) && /^https:\/\//i.test(address.trim())) return setAsPlain(true)
      // Self-signed: its fingerprint, for the user to compare with the server's own, instead of an error toast.
      const fp = /SHA-256 fingerprint: ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/.exec(String(e))?.[1]
      if (fp && !pin) return setFingerprint(fp)
      useStore.setState({ error: String(e) })
    }
  }
  const field = 'h-8 w-full rounded-md border border-line bg-bg px-2 text-xs'
  return (
    <div data-setting="Your music server" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      {list.map((s) => (
        <ServerAccount key={s.key} s={s} />
      ))}
      {!list.length && (
        <AccountLine on={false} icon={<HardDrives size={16} />} title={tr('Your music server')} pitch={tr('Your own music from Jellyfin, Plex, Navidrome or another Subsonic server, streamed from your server and played here like your files')} state={busy ?? tr('Not connected')}>
          <Button onClick={() => setForm((f) => !f)}>{tr('Sign in')}</Button>
        </AccountLine>
      )}
      {form && !list.length && (
        <div className="ml-13 @max-lg:ml-0 flex flex-col gap-2.5 rounded-lg border border-line bg-bg p-3 text-xs">
          <div className="flex flex-col gap-1.5">
            <span className="text-ink-2">{tr('Server type')}</span>
            <Segmented label={tr('Server type')} value={kind} onChange={setKind} options={SERVER_KINDS} />
            {kind === 'subsonic' && <span className="text-ink-2">{tr('Navidrome, Airsonic, Gonic, Ampache and other Subsonic-compatible servers')}</span>}
          </div>
          {kind === 'plex' ? (
            <PlexSignIn onSignedIn={signedIn} />
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready) void signIn()
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-ink-2">{tr('Address')}</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={kind === 'jellyfin' ? 'http://192.168.1.10:8096' : 'http://192.168.1.10:4533'} spellCheck={false} autoComplete="url" inputMode="url" className={`${field} font-mono`} />
              </label>
              {exposure === 'open' && (
                <p className="flex items-start gap-1.5 text-ink">
                  <Warning size={14} className="mt-px shrink-0" /> {tr(OPEN_WARNING)}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 @max-lg:grid-cols-1">
                <label className="flex flex-col gap-1">
                  <span className="text-ink-2">{tr('User')}</span>
                  <input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoComplete="username" className={field} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-2">{tr('Password')}</span>
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className={field} />
                </label>
              </div>
              <p className="flex items-start gap-1.5 text-ink-2">
                <ShieldCheck size={14} className="mt-px shrink-0" />{' '}
                {kind === 'jellyfin'
                  ? phoneApp
                    ? tr('Your password is sent once, to your server only; its access key stays in this phone’s secure storage. Legato talks to your server only, never to a server of ours.')
                    : tr('Your password is sent once, to your server only; its access key stays in this PC’s keychain. Legato talks to your server only, never to a server of ours.')
                  : phoneApp
                    ? tr('Your password stays in this phone’s secure storage. Legato talks to your server only, never to a server of ours.')
                    : tr('Your password stays in this PC’s keychain. Legato talks to your server only, never to a server of ours.')}
              </p>
              {fingerprint && !trusted && (
                <div className="flex flex-col gap-2 text-ink">
                  <p className="flex items-start gap-1.5">
                    <Warning size={14} className="mt-px shrink-0" /> {tr('This device doesn’t trust your server’s certificate (a self-signed one?). Trust it only if this SHA-256 fingerprint is the one your server shows:')}
                  </p>
                  <code className="break-all font-mono text-[11px] select-text">{fingerprint}</code>
                  <Button
                    className="w-fit"
                    disabled={!ready}
                    onClick={() => {
                      setTrusted(fingerprint)
                      void signIn(asPlain, fingerprint)
                    }}
                  >
                    {tr('Trust this certificate and sign in')}
                  </Button>
                </div>
              )}
              {asPlain && (
                <div className="flex flex-col gap-2 text-ink">
                  <p className="flex items-start gap-1.5">
                    <Warning size={14} className="mt-px shrink-0" /> {tr('Your server only takes the password sent as it is (hex-encoded, which is not encryption). Over https only your server can read it. Send it this way?')}
                  </p>
                  <Button className="w-fit" disabled={!ready} onClick={() => void signIn(true)}>
                    {tr('Send my password as it is')}
                  </Button>
                </div>
              )}
              <Button className="w-fit" type="submit" disabled={!ready}>
                {busy ?? tr('Sign in')}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

/** Music folders: scanned with tags, linked to tracks already known from other services. A phone's: its Music and Download. */
function LocalFolders() {
  const { refresh, tracks } = useStore(useShallow(({ refresh, tracks }) => ({ refresh, tracks })))
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)
  const files = tracks.filter((t) => t.ids.local).length
  useEffect(() => void api.localFolders().then(setFolders), [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setFolders(await api.localFolders())
      await refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  // Phone: Android's permission first (its dialog the first time); a scan it can't read would empty the folders' songs.
  const allowed = async (fn: (phone: string[]) => Promise<unknown>) => {
    const phone = await phoneFolders()
    setRefused(!phone)
    if (phone) await run(() => fn(phone))
  }
  const add = async () => {
    if (phoneApp) return allowed((phone) => api.setLocalFolders(withPhone(folders, phone)))
    const dir = await open({ directory: true, title: tr('Music folder') })
    if (typeof dir === 'string' && !folders.includes(dir)) await run(() => api.setLocalFolders([...folders, dir]))
  }
  const rescan = () => (phoneApp ? allowed(api.rescanLocal) : run(api.rescanLocal))

  return (
    <div data-setting="Local files" className="flex flex-col gap-3 px-4 py-3.5">
      <AccountLine on={folders.length > 0} icon={<SourceIcon source="local" size={16} />} title={tr('Local files')} pitch={tr('MP3, FLAC, WAV, OGG, M4A. Linked to your YouTube and Spotify tracks and played first, gapless.')} state={busy ? tr('Scanning…') : trn(files, '{n} file', '{n} files')} />
      {folders.length > 0 && (
        <ul className="ml-13 @max-lg:ml-0 flex flex-col rounded-lg border border-line-soft">
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-2 border-b border-line-soft py-1 pr-1 pl-3 last:border-0">
              <span className="flex-1 truncate font-mono text-[0.6875rem]">{f}</span>
              <RoundButton label={tr('Remove {folder}', { folder: f })} kind="plain" size="xs" disabled={busy} onClick={() => run(() => api.setLocalFolders(folders.filter((x) => x !== f)))}>
                <X size={12} />
              </RoundButton>
            </li>
          ))}
        </ul>
      )}
      {refused && (
        <p className="ml-13 @max-lg:ml-0 text-xs text-ink">
          {tr(MUSIC_REFUSED)}{' '}
          <button onClick={() => openAppInfo()} className="font-medium underline-offset-2 hover:underline">
            {tr('Open app info')}
          </button>
        </p>
      )}
      <div className="ml-13 @max-lg:ml-0 flex gap-2">
        <Button disabled={busy} onClick={() => void add()}>
          {phoneApp ? <DeviceMobile size={14} /> : <FolderPlus size={14} />} {phoneApp ? tr('Find my songs') : tr('Add folder')}
        </Button>
        {folders.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => void rescan()}>
            {tr('Rescan')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function SourcesView() {
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <p className="text-[0.8125rem] text-ink-2">{phoneApp ? tr('Which account is connected to which service. Nothing goes through a server of ours: everything stays on your phone.') : tr('Which account is connected to which service. Nothing goes through a server of ours: everything stays on your computer.')}</p>
      <div className="rounded-xl border border-line bg-raised">
        <GoogleAccounts />
        {/* A player and an import in windows: none on the phone (FromPc). */}
        {!phoneApp && <SpotifyWeb />}
        <ServiceRow service="spotify" />
        <AppleWeb />
        <LastfmRow />
        <ListenbrainzRow />
        <ServerRow />
        <LocalFolders />
      </div>
      {/* Google's sign-in is the PC's only (it refuses phone apps). */}
      {!phoneApp && (
        <p className="flex w-fit items-center gap-2.5 text-xs text-ink-2">
          <ShieldCheck size={16} /> {tr('You type your password on Google’s own page, never in Legato. The session stays in the app’s browser storage on this PC, like in a browser.')}
        </p>
      )}
    </div>
  )
}
