import { FolderPlus, GoogleLogo, HardDrives, ShieldCheck, SignOut, UserPlus, X } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { accountKey, api, type YtmAccount } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton, Toggle } from '../../shared/ui/controls'
import { remoteArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'

function ServiceRow({ service }: { service: 'spotify' }) {
  const { status, disconnect, busy, go, view } = useStore()
  const { connected } = status[service]
  const selected = view.name === 'settings' && view.wizard === service
  return (
    <div className={`flex items-center gap-4 border-b border-line-soft px-4 py-3.5 ${selected ? 'bg-bg' : ''}`}>
      <Led on={connected} />
      <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
        <SourceIcon source={service} size={16} />
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold">{sourceLabel[service]}</p>
        <p className="text-xs text-ink-2">{guides[service].pitch}</p>
      </div>
      <span className="kicker">{connected ? 'Connected' : 'Not connected'}</span>
      {connected ? (
        <Button variant="ghost" disabled={busy} onClick={() => disconnect(service)}>
          Disconnect
        </Button>
      ) : (
        <Button onClick={() => go({ name: 'settings', section: 'sources', wizard: service })}>Connect</Button>
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
    <div className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5">
      <Led on={!!on} />
      <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
        <SourceIcon source="spotify" size={16} />
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold">Spotify web player <span className="kicker">Preview</span></p>
        <p className="text-xs text-ink-2">Spotify's own player in a window, signed in on Spotify's page. To import a public playlist, paste its link anywhere (Ctrl+V).</p>
      </div>
      <span className="kicker">{on ? 'Signed in' : 'Not signed in'}</span>
      <Button variant={on ? 'ghost' : undefined} onClick={() => api.spotifyWebOpen().catch((e) => useStore.setState({ error: String(e) }))}>
        Open
      </Button>
    </div>
  )
}

/** YouTube Music through a normal Google sign-in (like Pear Desktop): no keys. Several Google accounts / channels, pick which to sync. */
function GoogleAccounts() {
  const refresh = useStore((s) => s.refresh)
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
        void refresh()
      }
    }, 2000)
    return () => clearInterval(id)
  }, [waiting, load, refresh, data?.accounts.length])

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
    if (!confirm('Sign every Google account out of Music App? Your library stays as it is.')) return
    await api.ytmSignOut().catch((e) => useStore.setState({ error: String(e) }))
    await load()
    void refresh()
  }

  return (
    <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={!!data?.signedIn} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <SourceIcon source="youtube" size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold">YouTube Music</p>
          <p className="text-xs text-ink-2">Sign in with Google: your library, playlists, search and export. No keys, no daily limit.</p>
        </div>
        <span className="kicker">{data?.signedIn ? `${data.accounts.length} account${data.accounts.length > 1 ? 's' : ''}` : waiting ? 'Waiting for Google…' : 'Not signed in'}</span>
        {!data?.signedIn && (
          <Button onClick={() => signIn(false)}>
            <GoogleLogo size={14} weight="bold" /> Sign in with Google
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
                <li key={accountKey(a)} className="flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-0">
                  <Cover title={a.name} art={a.photo ? [remoteArt(a.photo)] : []} size={30} className="rounded-full!" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                      {a.name} {first && on && <span className="kicker">Exports here</span>}
                    </p>
                    <p className="truncate text-xs text-ink-2">{[a.handle, a.email, a.pageId && 'channel'].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className="text-xs text-ink-2">Sync</span>
                  <Toggle label={`Sync ${a.name}`} checked={on} onChange={(v) => toggle(a, v)} />
                </li>
              )
            })}
          </ul>
          <div className="ml-13 flex gap-2">
            <Button variant="ghost" onClick={() => signIn(true)}>
              <UserPlus size={14} /> {waiting ? 'Waiting for Google…' : 'Add another Google account'}
            </Button>
            <Button variant="ghost" onClick={signOut}>
              <SignOut size={14} /> Sign out
            </Button>
          </div>
          <p className="ml-13 text-xs text-ink-2">Synced accounts bring their playlists and Liked Music into your library. YouTube Music doesn't offer an official way in without keys: this uses the site's own access, like Pear Desktop, and may break if YouTube changes it.</p>
        </>
      )}
    </div>
  )
}

/** Music folders: scanned with tags, linked to tracks already known from other services. */
function LocalFolders() {
  const { refresh, tracks } = useStore()
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
    const dir = await open({ directory: true, title: 'Music folder' })
    if (typeof dir === 'string' && !folders.includes(dir)) await run(() => api.setLocalFolders([...folders, dir]))
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={folders.length > 0} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <HardDrives size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold">Local files</p>
          <p className="text-xs text-ink-2">MP3, FLAC, WAV, OGG, M4A. Linked to your YouTube and Spotify tracks and played first, gapless.</p>
        </div>
        <span className="kicker">{busy ? 'Scanning…' : `${formatCount(files)} files`}</span>
      </div>
      {folders.length > 0 && (
        <ul className="ml-13 flex flex-col rounded-lg border border-line-soft">
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-2 border-b border-line-soft py-1 pr-1 pl-3 last:border-0">
              <span className="flex-1 truncate font-mono text-[11px]">{f}</span>
              <RoundButton label={`Remove ${f}`} kind="plain" size="xs" disabled={busy} onClick={() => run(() => api.setLocalFolders(folders.filter((x) => x !== f)))}>
                <X size={12} />
              </RoundButton>
            </li>
          ))}
        </ul>
      )}
      <div className="ml-13 flex gap-2">
        <Button disabled={busy} onClick={add}>
          <FolderPlus size={14} /> Add folder
        </Button>
        {folders.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => run(api.rescanLocal)}>
            Rescan
          </Button>
        )}
      </div>
    </div>
  )
}

export function SourcesView() {
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <p className="text-[13px] text-ink-2">Which account is connected to which service. Nothing goes through a server of ours: everything stays on your computer.</p>
      <div className="rounded-xl border border-line bg-raised">
        <GoogleAccounts />
        <SpotifyWeb />
        <ServiceRow service="spotify" />
        <LocalFolders />
      </div>
      <p className="flex w-fit items-center gap-2.5 text-xs text-ink-2">
        <ShieldCheck size={16} /> You type your password on Google's own page, never in Music App. The session stays in the app's browser storage on this PC, like in a browser.
      </p>
    </div>
  )
}
