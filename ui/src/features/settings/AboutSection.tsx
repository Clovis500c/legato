import { ArrowClockwise, ArrowSquareOut, Disc, DownloadSimple } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type CacheStat, type CacheStats, type UpdateStatus } from '../../shared/api'
import { formatBytes, formatCount, timeAgo } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Toggle } from '../../shared/ui/controls'
import { groupAlbums, groupArtists } from '../library/filter'
import { installUpdate, useUpdate } from '../update/updates'
import { msg, tr, trn } from '../../shared/i18n/i18n'

const REPO = 'https://github.com/Clovis500c/music-app'

// Status colors keep their meaning whatever the theme.
const pill: Record<UpdateStatus['state'], { color: string; pulse?: boolean }> = {
  idle: { color: '#80848E' },
  checking: { color: '#3B82F6', pulse: true },
  upToDate: { color: '#23A55A' },
  downloading: { color: '#3B82F6', pulse: true },
  available: { color: '#3B82F6' },
  ready: { color: '#F0B232', pulse: true },
  installing: { color: '#F0B232', pulse: true },
  error: { color: '#F23F43' },
}

function label(s: UpdateStatus | null): string {
  if (!s) return tr('Not checked yet')
  switch (s.state) {
    case 'checking':
      return tr('Checking for updates…')
    case 'upToDate':
      return tr('Up to date')
    case 'downloading':
      return tr('Downloading {version} · {percent} %', { version: s.version, percent: s.percent })
    case 'available':
      return tr('{version} is out', { version: s.version })
    case 'ready':
      return tr('{version} is ready', { version: s.version })
    case 'installing':
      return tr('Installing {version}…', { version: s.version })
    case 'error':
      return tr('Couldn’t check for updates')
    default:
      return tr('Not checked yet')
  }
}

function Row({ label: name, sub, children }: { label: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div data-setting={name} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium">{tr(name)}</p>
        {sub && <div className="text-xs text-ink-2">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/** Share of answers served from memory. */
const rate = (c?: CacheStat) => (c && c.hits + c.misses ? tr('{n} % from memory', { n: Math.round((c.hits / (c.hits + c.misses)) * 100) }) : tr('Nothing asked yet'))

function Stat({ value, name }: { value: string; name: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-bg px-3.5 py-3">
      <span className="text-lg font-bold tabular-nums">{value}</span>
      <span className="kicker">{name}</span>
    </div>
  )
}

/** Settings › About: version, updates, the app's state. */
export function AboutSection() {
  const { settings: s, update } = useSettings()
  const status = useUpdate((u) => u.status)
  const { tracks, playlists, stats, notify } = useStore(useShallow(({ tracks, playlists, stats, notify }) => ({ tracks, playlists, stats, notify })))
  const [cache, setCache] = useState<CacheStats>()
  useEffect(() => {
    const load = () =>
      api
        .cacheStats()
        .then(setCache)
        .catch(() => {})
    void load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])
  const counts = useMemo(() => ({ albums: groupAlbums(tracks).length, artists: groupArtists(tracks).length, plays: Object.values(stats).reduce((n, [p]) => n + p, 0) }), [tracks, stats])
  const state = status?.state ?? 'idle'
  const busy = state === 'checking' || state === 'downloading' || state === 'installing'
  const { color, pulse } = pill[state]

  return (
    <div className="flex max-w-190 flex-col gap-6">
      <div className="flex items-center gap-5 rounded-xl border border-line bg-raised p-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
          <Disc size={34} weight="fill" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xl font-bold tracking-[-0.02em]">Legato</p>
          <p className="font-mono text-xs text-ink-2">{tr('Version {version}', { version: status?.current ?? '…' })}</p>
          <p className="flex items-center gap-2 text-xs">
            <span className={`size-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            {label(status)}
          </p>
        </div>
        {state === 'ready' ? (
          <Button onClick={() => void installUpdate()}>
            <DownloadSimple size={14} /> {tr('Restart and update')}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => void api.updateCheck()}>
            <ArrowClockwise size={14} className={busy ? 'animate-spin' : ''} /> {state === 'available' ? tr('Download update') : tr('Check now')}
          </Button>
        )}
      </div>
      {state === 'downloading' && status?.state === 'downloading' && (
        <div className="-mt-3 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${status.percent}%` }} />
        </div>
      )}

      <section data-setting="Updates" className="flex flex-col gap-2.5">
        <h2 className="kicker">{tr('Updates')}</h2>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Automatic updates')} sub={tr('Checked at every launch. Downloads in the background and installs between two songs or once nothing plays, then the app picks up where it was')}>
            <Toggle label={tr('Automatic updates')} checked={s.autoUpdate} onChange={(autoUpdate) => update({ autoUpdate })} />
          </Row>
          <Row label={msg('Last update')} sub={status?.lastUpdate ? `${status.lastUpdate.from} → ${status.lastUpdate.to}, ${timeAgo(status.lastUpdate.at * 1000)}` : tr('None installed yet')} />
          <Row label={msg('Last check')} sub={status?.lastCheck ? timeAgo(status.lastCheck * 1000) : tr('Not this session')} />
          {status?.state === 'error' && <Row label={msg('Error')} sub={<span className="break-words">{status.message}</span>} />}
          {(status?.state === 'ready' || status?.state === 'available') && status.notes && (
            <Row label={tr('What’s new in {version}', { version: status.version })} sub={<span className="whitespace-pre-wrap">{status.notes}</span>} />
          )}
          {status?.state !== 'ready' && status?.state !== 'available' && status?.lastUpdate?.notes && (
            <Row label={tr('What’s new in {version}', { version: status.lastUpdate.to })} sub={<span className="whitespace-pre-wrap">{status.lastUpdate.notes}</span>} />
          )}
        </div>
      </section>

      <section data-setting="App status" className="flex flex-col gap-2.5">
        <h2 className="kicker">{tr('App status')}</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 rounded-xl border border-line bg-raised p-3">
          <Stat value={formatCount(tracks.length)} name={tr('Songs')} />
          <Stat value={formatCount(counts.albums)} name={tr('Albums')} />
          <Stat value={formatCount(counts.artists)} name={tr('Artists')} />
          <Stat value={formatCount(playlists.length)} name={tr('Playlists')} />
          <Stat value={formatCount(counts.plays)} name={tr('Listens')} />
        </div>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Library cache')} sub={`${rate(cache?.library)} · ${tr('kept until the library changes')}`} />
          <Row label={msg('Mixes cache')} sub={`${rate(cache?.mixes)} · ${tr('rebuilt when you listen, each hour and each day')}`} />
          <Row label={msg('Images in memory')} sub={cache ? `${formatBytes(cache.images.bytes)} · ${trn(cache.images.entries, '{n} cover', '{n} covers')} · ${rate(cache.images)}` : '…'} />
        </div>
      </section>

      <section data-setting="About" data-brand className="flex flex-col gap-2.5">
        <h2 className="kicker">{tr('About')}</h2>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Source code')} sub={tr('Source-available: free to use, not to copy. Built with Tauri 2, Rust and React.')}>
            <Button variant="ghost" onClick={() => void openUrl(REPO).catch(() => {})}>
              <ArrowSquareOut size={14} /> GitHub
            </Button>
          </Row>
          <Row label={msg('Third-party licenses')} sub={tr('The open-source components the app is built on: their licenses, copyright notices and source links.')}>
            <Button variant="ghost" onClick={() => void api.openLicenses().catch(() => notify(tr('Couldn’t open the licenses file'), { kind: 'error' }))}>
              <ArrowSquareOut size={14} /> {tr('Open')}
            </Button>
          </Row>
          <Row label={msg('Privacy')} sub={tr('No server, no account of ours: your library, history and settings stay on this PC.')} />
        </div>
      </section>
    </div>
  )
}
