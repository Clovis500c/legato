import { ArrowClockwise, ArrowSquareOut, Disc, DownloadSimple } from '@phosphor-icons/react'
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

const REPO = 'https://github.com/Clovis500c/music-app'

// Status colors keep their meaning whatever the theme.
const pill: Record<UpdateStatus['state'], { color: string; pulse?: boolean }> = {
  idle: { color: '#80848E' },
  checking: { color: '#3B82F6', pulse: true },
  upToDate: { color: '#23A55A' },
  downloading: { color: '#3B82F6', pulse: true },
  ready: { color: '#F0B232', pulse: true },
  installing: { color: '#F0B232', pulse: true },
  error: { color: '#F23F43' },
}

function label(s: UpdateStatus | null): string {
  if (!s) return 'Not checked yet'
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'upToDate':
      return 'Up to date'
    case 'downloading':
      return `Downloading ${s.version} · ${s.percent} %`
    case 'ready':
      return `${s.version} is ready`
    case 'installing':
      return `Installing ${s.version}…`
    case 'error':
      return 'Couldn’t check for updates'
    default:
      return 'Not checked yet'
  }
}

function Row({ label: name, sub, children }: { label: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div data-setting={name} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{name}</p>
        {sub && <div className="text-xs text-ink-2">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/** Share of answers served from memory. */
const rate = (c?: CacheStat) => (c && c.hits + c.misses ? `${Math.round((c.hits / (c.hits + c.misses)) * 100)} % from memory` : 'Nothing asked yet')

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
  const { tracks, playlists, stats } = useStore()
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
          <p className="text-xl font-bold tracking-[-0.02em]">Music App</p>
          <p className="font-mono text-xs text-ink-2">Version {status?.current ?? '…'}</p>
          <p className="flex items-center gap-2 text-xs">
            <span className={`size-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            {label(status)}
          </p>
        </div>
        {state === 'ready' ? (
          <Button onClick={() => void installUpdate()}>
            <DownloadSimple size={14} /> Restart and update
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => void api.updateCheck()}>
            <ArrowClockwise size={14} className={busy ? 'animate-spin' : ''} /> Check now
          </Button>
        )}
      </div>
      {state === 'downloading' && status?.state === 'downloading' && (
        <div className="-mt-3 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${status.percent}%` }} />
        </div>
      )}

      <section data-setting="Updates" className="flex flex-col gap-2.5">
        <h2 className="kicker">Updates</h2>
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Automatic updates" sub="Downloads in the background and installs once nothing has played for a moment; the app opens again where it was, paused if it was">
            <Toggle label="Automatic updates" checked={s.autoUpdate} onChange={(autoUpdate) => update({ autoUpdate })} />
          </Row>
          <Row label="Last update" sub={status?.lastUpdate ? `${status.lastUpdate.from} → ${status.lastUpdate.to}, ${timeAgo(status.lastUpdate.at * 1000)}` : 'None installed yet'} />
          <Row label="Last check" sub={status?.lastCheck ? timeAgo(status.lastCheck * 1000) : 'Not this session'} />
          {status?.state === 'error' && <Row label="Error" sub={<span className="break-words">{status.message}</span>} />}
          {status?.state === 'ready' && status.notes && (
            <Row label={`What’s new in ${status.version}`} sub={<span className="whitespace-pre-wrap">{status.notes}</span>} />
          )}
        </div>
      </section>

      <section data-setting="App status" className="flex flex-col gap-2.5">
        <h2 className="kicker">App status</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 rounded-xl border border-line bg-raised p-3">
          <Stat value={formatCount(tracks.length)} name="Songs" />
          <Stat value={formatCount(counts.albums)} name="Albums" />
          <Stat value={formatCount(counts.artists)} name="Artists" />
          <Stat value={formatCount(playlists.length)} name="Playlists" />
          <Stat value={formatCount(counts.plays)} name="Listens" />
        </div>
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Library cache" sub={`${rate(cache?.library)} · kept until the library changes`} />
          <Row label="Mixes cache" sub={`${rate(cache?.mixes)} · rebuilt when you listen, each hour and each day`} />
          <Row label="Images in memory" sub={cache ? `${formatBytes(cache.images.bytes)} · ${formatCount(cache.images.entries)} covers · ${rate(cache.images)}` : '…'} />
        </div>
      </section>

      <section data-setting="About" className="flex flex-col gap-2.5">
        <h2 className="kicker">About</h2>
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Source code" sub="Source-available: free to use, not to copy. Built with Tauri 2, Rust and React.">
            <Button variant="ghost" onClick={() => void openUrl(REPO).catch(() => {})}>
              <ArrowSquareOut size={14} /> GitHub
            </Button>
          </Row>
          <Row label="Privacy" sub="No server, no account of ours: your library, history and settings stay on this PC." />
        </div>
      </section>
    </div>
  )
}
