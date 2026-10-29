import { ArrowsClockwise, FolderPlus, GoogleLogo, HardDrives, ShieldCheck, SignOut, UserPlus, X } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { accountKey, api, type Direction, type YtmAccount } from '../../shared/api'
import { timeAgo } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { remoteArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { ask } from '../../shared/ui/Ask'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useLastfm } from './lastfm'

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

/** Spotify: playlists come in only (sending to Spotify isn't built: no Premium account to test it on). */
function DirectionPicker({ service, value, onChange, receives = true }: { service: string; value: Direction; onChange: (d: Direction) => void; receives?: boolean }) {
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
      <p className="text-xs text-ink-2">{tr(directionHelp[shown], { service })}</p>
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
      <div className="flex items-center gap-4">
        <Led on={connected} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <SourceIcon source={service} size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[0.8125rem] font-semibold">{sourceLabel[service]}</p>
          <p className="text-xs text-ink-2">{tr(guides[service].pitch)}</p>
        </div>
        <span className="kicker">{connected ? tr('Connected') : tr('Not connected')}</span>
        {connected ? (
          <Button variant="ghost" disabled={busy} onClick={() => disconnect(service)}>
            {tr('Disconnect')}
          </Button>
        ) : (
          <Button onClick={() => go({ name: 'settings', section: 'sources', wizard: service })}>{tr('Connect')}</Button>
        )}
      </div>
      {connected && (
        <div className="ml-13">
          <DirectionPicker service={sourceLabel[service]} value={dirs.spotify ?? 'both'} onChange={(d) => setDir('spotify', d)} receives={false} />
        </div>
      )}
    </div>
  )
}

/** Prototype: Spotify's official web player in a window, signed in on Spotify's page (no keys). Library import: not yet. */
function SpotifyWeb() {
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    const check = () => void api.spotifyWebStatus().then(setOn, () => setOn(false))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
  return (
    <div data-setting="Spotify web player" className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5">
      <Led on={!!on} />
      <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
        <SourceIcon source="spotify" size={16} />
      </span>
      <div className="flex-1">
        <p className="text-[0.8125rem] font-semibold">{tr('Spotify web player')} <span className="kicker">{tr('Preview')}</span></p>
        <p className="text-xs text-ink-2">{tr('Spotify’s own player in a window, signed in on Spotify’s page. To import a public playlist, paste its link anywhere (Ctrl+V).')}</p>
      </div>
      <span className="kicker">{on ? tr('Signed in') : tr('Not signed in')}</span>
      <Button variant={on ? 'ghost' : undefined} onClick={() => api.spotifyWebOpen().catch((e) => useStore.setState({ error: String(e) }))}>
        {tr('Open')}
      </Button>
    </div>
  )
}

/** Last.fm: your own free API key (last.fm/api), then you allow the app on last.fm. Listens go to your profile. */
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
    if (!(await ask({ title: tr('Stop scrobbling to Last.fm?'), body: tr('The key, secret and session are removed from this PC. Your Last.fm profile keeps what was sent.'), ok: tr('Disconnect') }))) return
    await api.lastfmDisconnect().catch(() => {})
    void refresh()
  }
  const field = 'h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-xs'
  return (
    <div data-setting="Last.fm" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={!!user} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-xs font-bold text-ink-2">fm</span>
        <div className="flex-1">
          <p className="text-[0.8125rem] font-semibold">Last.fm</p>
          <p className="text-xs text-ink-2">{user ? tr('Every song you listen to goes to your profile (half of it or 4 minutes heard)') : tr('Scrobbling: your listens on your Last.fm profile, from every source. Free, with your own API key')}</p>
        </div>
        <span className="kicker">{user ? (waiting ? tr('{user} · {n} waiting', { user, n: waiting }) : user) : configured ? tr('Signed out') : tr('Not connected')}</span>
        {user ? (
          <Button variant="ghost" onClick={() => void disconnect()}>
            {tr('Disconnect')}
          </Button>
        ) : (
          <Button onClick={() => setForm((f) => !f)}>{tr('Connect')}</Button>
        )}
      </div>
      {form && !user && (
        <div className="ml-13 flex flex-col gap-2 rounded-lg border border-line bg-bg p-3 text-xs">
          <p className="text-ink-2">
            {tr('1. Create a free API account on last.fm (any name, no callback needed). 2. Paste its API key and shared secret. 3. Allow Music App on the page that opens.')}{' '}
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

/** YouTube Music through a normal Google sign-in (like Pear Desktop): no keys. Several Google accounts / channels, pick which to sync. */
function GoogleAccounts() {
  const { refresh, sync, busy, lastSync } = useStore(useShallow(({ refresh, sync, busy, lastSync }) => ({ refresh, sync, busy, lastSync })))
  const [data, setData] = useState<{ signedIn: boolean; accounts: YtmAccount[]; picked: string[] }>()
  const [waiting, setWaiting] = useState(false)
  const [dirs, setDir] = useDirections()
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
  const toggle = async (a: YtmAccount, on: boolean) => {
    if (!data) return
    const keys = on ? [...data.picked, accountKey(a)] : data.picked.filter((k) => k !== accountKey(a))
    await api.setYtmAccounts(data.accounts.filter((x) => keys.includes(accountKey(x)))).catch((e) => useStore.setState({ error: String(e) }))
    await load()
  }
  const signOut = async () => {
    if (!(await ask({ title: tr('Sign out of Google?'), body: tr('Every Google account leaves Music App. Your library stays as it is.'), ok: tr('Sign out') }))) return
    await api.ytmSignOut().catch((e) => useStore.setState({ error: String(e) }))
    await load()
    void refresh()
  }

  return (
    <div data-setting="YouTube Music" className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={!!data?.signedIn} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <SourceIcon source="youtube" size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[0.8125rem] font-semibold">YouTube Music</p>
          <p className="text-xs text-ink-2">{data?.signedIn ? tr('Your playlists, search and export. No keys, no daily limit.') : tr('Sign in with Google to import your YouTube Music playlists and Liked Music. No keys.')}</p>
        </div>
        <span className="kicker">{data?.signedIn ? trn(data.accounts.length, '{n} account', '{n} accounts') : waiting ? tr('Waiting for Google…') : tr('Not signed in')}</span>
        {!data?.signedIn && (
          <Button onClick={() => signIn(false)}>
            <GoogleLogo size={14} weight="bold" /> {tr('Sign in with Google')}
          </Button>
        )}
      </div>
      {data?.signedIn && (
        <>
          <ul className="ml-13 flex flex-col rounded-lg border border-line-soft">
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
                    <div className="ml-[42px]">
                      <DirectionPicker service="YouTube Music" value={dirs[`youtube:${accountKey(a)}`] ?? 'both'} onChange={(d) => setDir(`youtube:${accountKey(a)}`, d)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="ml-13 flex items-center gap-3 rounded-lg bg-recess px-3 py-2.5">
            <div className="flex-1">
              <p className="text-[0.8125rem] font-medium">{tr('Playlists and Liked Music')}</p>
              <p className="text-xs text-ink-2">{busy ? tr('Importing…') : lastSync ? tr('Last import {when}: {n} playlists', { when: timeAgo(lastSync.at), n: lastSync.report.playlists }) : tr('Imported when you sign in. Import again any time to pick up changes.')}</p>
            </div>
            <Button disabled={busy || !data.picked.length} onClick={() => void sync()}>
              <ArrowsClockwise size={14} className={busy ? 'animate-spin' : ''} /> {tr('Import playlists now')}
            </Button>
          </div>
          <div className="ml-13 flex gap-2">
            <Button variant="ghost" onClick={() => signIn(true)}>
              <UserPlus size={14} /> {waiting ? tr('Waiting for Google…') : tr('Add another Google account')}
            </Button>
            <Button variant="ghost" onClick={signOut}>
              <SignOut size={14} /> {tr('Sign out')}
            </Button>
          </div>
          <p className="ml-13 text-xs text-ink-2">{tr('Synced accounts bring their playlists and Liked Music into your library. YouTube Music doesn’t offer an official way in without keys: this uses the site’s own access, like Pear Desktop, and may break if YouTube changes it.')}</p>
        </>
      )}
    </div>
  )
}

/** Music folders: scanned with tags, linked to tracks already known from other services. */
function LocalFolders() {
  const { refresh, tracks } = useStore(useShallow(({ refresh, tracks }) => ({ refresh, tracks })))
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
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
  const add = async () => {
    const dir = await open({ directory: true, title: tr('Music folder') })
    if (typeof dir === 'string' && !folders.includes(dir)) await run(() => api.setLocalFolders([...folders, dir]))
  }

  return (
    <div data-setting="Local files" className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={folders.length > 0} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <HardDrives size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[0.8125rem] font-semibold">{tr('Local files')}</p>
          <p className="text-xs text-ink-2">{tr('MP3, FLAC, WAV, OGG, M4A. Linked to your YouTube and Spotify tracks and played first, gapless.')}</p>
        </div>
        <span className="kicker">{busy ? tr('Scanning…') : trn(files, '{n} file', '{n} files')}</span>
      </div>
      {folders.length > 0 && (
        <ul className="ml-13 flex flex-col rounded-lg border border-line-soft">
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
      <div className="ml-13 flex gap-2">
        <Button disabled={busy} onClick={add}>
          <FolderPlus size={14} /> {tr('Add folder')}
        </Button>
        {folders.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => run(api.rescanLocal)}>
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
      <p className="text-[0.8125rem] text-ink-2">{tr('Which account is connected to which service. Nothing goes through a server of ours: everything stays on your computer.')}</p>
      <div className="rounded-xl border border-line bg-raised">
        <GoogleAccounts />
        <SpotifyWeb />
        <ServiceRow service="spotify" />
        <LastfmRow />
        <LocalFolders />
      </div>
      <p className="flex w-fit items-center gap-2.5 text-xs text-ink-2">
        <ShieldCheck size={16} /> {tr('You type your password on Google’s own page, never in Music App. The session stays in the app’s browser storage on this PC, like in a browser.')}
      </p>
    </div>
  )
}
