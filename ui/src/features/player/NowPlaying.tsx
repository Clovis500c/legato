import { ArrowSquareOut, CaretDoubleDown, Lock, Waveform } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import type { LibraryTrack, Source } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { Button } from '../../shared/ui/Button'
import { Bar, Led, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { useAmbient } from './ambient'
import { clock, fileFormat, VolumeControl } from './PlayerBar'
import { viaLabel, vias, type Via } from './sources'
import { fileTitle, usePlayer, useVideoSlot } from './store'
import { Transport } from './Transport'

/** Publishes its rect so the single YouTube iframe sits here. YouTube rules: at least 200×200, nothing on top. */
export function VideoSlot({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = useVideoSlot((s) => s.set)
  useLayoutEffect(() => {
    const el = ref.current!
    const update = () => set(el.getBoundingClientRect())
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    // Capture: any scrolling ancestor moves the slot.
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      set(null)
    }
  }, [set])
  return <div ref={ref} className={`rounded-lg bg-black ${className}`} style={style} />
}

/** Seek bar drawn like a tuner dial: ticks, major every 5, accent needle. */
function TunerScale({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const pct = max ? Math.min(1, value / max) : 0
  return (
    <div className="relative h-6 w-full">
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line" />
      <div className="absolute bottom-0 left-0 h-0.5 bg-ink" style={{ width: `${pct * 100}%` }} />
      {Array.from({ length: 57 }, (_, i) => (
        <span key={i} className={`absolute bottom-0.5 w-px ${i % 5 ? 'h-1.5' : 'h-3'} ${i / 56 <= pct ? 'bg-ink-2' : 'bg-ink-4'}`} style={{ left: `${(i / 56) * 100}%` }} />
      ))}
      <span className="absolute bottom-0 h-6 w-0.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${pct * 100}%` }} />
      <input type="range" aria-label="Position" min={0} max={max || 1} step="any" value={Math.min(value, max)} disabled={!max} onChange={(e) => onChange(+e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </div>
  )
}

/** "Play via": one round input per source of this track. Lit = playing. Spotify locked until connected (Premium). */
function Inputs({ track }: { track?: LibraryTrack }) {
  const { now, index, playAt } = usePlayer()
  const sp = useStore((s) => s.status.spotify.connected)
  const has = track ? vias(track, sp) : []
  const items: { code: string; source: Source; via: Via }[] = [
    { code: 'LOC', source: 'local', via: 'local' },
    { code: 'YT', source: 'youtube', via: 'youtube' },
    { code: 'SP', source: 'spotify', via: 'spotify' },
    { code: 'AM', source: 'apple', via: 'preview' },
  ]
  return (
    <div className="flex flex-col gap-2">
      <span className="kicker">Play via</span>
      <div className="flex gap-3">
        {items.map((i) => {
          const on = now?.via === i.via
          const can = has.includes(i.via)
          const locked = i.via === 'spotify' && !sp
          const hint = locked ? 'Spotify: connect a Premium account (Settings › Sources)' : on ? `Playing: ${viaLabel[i.via]}` : can ? `Switch to ${viaLabel[i.via]}` : 'Not on this source'
          return (
            <button key={i.code} disabled={!can || on} onClick={() => playAt(index, i.via)} title={hint} aria-label={hint} aria-pressed={on} className="group flex flex-col items-center gap-1.5">
              <Led on={on} />
              <span className={`grid size-10 place-items-center rounded-full border transition ${on ? 'border-ink-3 bg-raised text-ink' : can ? 'border-line text-ink-2 group-hover:bg-raised group-hover:text-ink' : 'border-line text-ink-4'}`}>
                {locked ? <Lock size={14} /> : <SourceIcon source={i.source} size={14} />}
              </span>
              <span className={`font-mono text-[9px] tracking-[0.08em] ${on ? 'text-ink' : 'text-ink-3'}`}>{i.code}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Video or cover, as big as the space allows without pushing the controls off screen. */
function Stage({ video, track, title }: { video: boolean; track?: LibraryTrack; title: string }) {
  const ratio = video ? 16 / 9 : 1
  // Container query units: fit inside both width and height, keep the ratio.
  const fit = { width: `min(100cqw, 100cqh * ${ratio})`, aspectRatio: String(ratio) }
  return (
    <div className="grid min-h-50 flex-1 place-items-center" style={{ containerType: 'size' }}>
      {video ? (
        <VideoSlot className="min-h-50 min-w-89" style={fit} />
      ) : (
        <span style={fit} className="block">
          <Cover title={track?.album ?? title} art={track && trackArt(track)} size={200} className="size-full! text-[56px]! shadow-[0_12px_40px_var(--shadow)]" />
        </span>
      )}
    </div>
  )
}

export function NowPlaying() {
  const { now, positionMs, durationMs, seek, setFull, list, index, order, upcoming, playAt } = usePlayer()
  const { tuner, tint } = useSettings((s) => s.settings)
  // Re-rendered by the settings subscription above.
  const theme = useSettings.getState().current()
  const track = useStore((s) => s.tracks.find((t) => t.id === now?.trackId))
  const sp = useStore((s) => s.status.spotify.connected)
  const ambient = useAmbient(tint && track ? trackArt(track)[0] : undefined, theme)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFull])
  useEffect(() => {
    if (!now) setFull(false)
  }, [now, setFull])
  if (!now) return null

  const video = now.via === 'youtube'
  // Play order (shuffle aware), after the current track.
  const at = order.indexOf(index)
  const next = now.trackId
    ? order.slice(at + 1).flatMap((i) => (list[i] && vias(list[i], sp).length ? [{ key: `${i}`, title: list[i].title, artist: list[i].artist, art: trackArt(list[i]), onPlay: () => playAt(i) }] : []))
    : upcoming.map((p) => ({ key: p, title: fileTitle(p), artist: fileFormat(p) ?? '', art: [], onPlay: undefined }))

  return (
    <div role="dialog" aria-label="Now playing" className="fixed inset-0 z-20 flex flex-col bg-bg px-10 pb-7 text-ink transition-colors duration-500" style={ambient}>
      <div data-tauri-drag-region className="flex h-14 shrink-0 items-center justify-between">
        <div className="flex w-60 items-center gap-2.5">
          <RoundButton label="Collapse (Esc)" size="sm" onClick={() => setFull(false)}>
            <CaretDoubleDown size={14} />
          </RoundButton>
          <span className="kicker">Collapse</span>
        </div>
        <span className="kicker text-ink-2">Now playing · {viaLabel[now.via]}</span>
        <span className="w-60" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-10 pt-2">
        <section className="flex min-h-0 min-w-0 flex-col gap-5">
          <Stage video={video} track={track} title={now.title} />
          {now.via === 'spotify' && <span className="kicker text-center">Playing in your Spotify app</span>}
          {now.via === 'preview' && (
            <div className="flex items-center justify-center gap-4">
              <span className="kicker">30-second preview</span>
              {now.page && (
                <Button variant="link" className="text-xs" onClick={() => openUrl(now.page!)}>
                  Listen on Apple Music <ArrowSquareOut size={13} />
                </Button>
              )}
            </div>
          )}
          <div className="flex shrink-0 items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 className="truncate text-[32px] leading-tight font-bold tracking-[-0.03em]">{now.title}</h2>
              <p className="truncate text-sm text-ink-2">{track?.album ? `${now.artist} — ${track.album}` : now.artist}</p>
            </div>
            <div className="flex shrink-0 items-end gap-4">
              {track && <AddToPlaylist trackIds={[track.id]} label={`Add ${track.title} to a playlist`} />}
              <div className="flex items-end gap-2 rounded-md border border-line-soft bg-recess px-3.5 py-2 font-mono tabular-nums">
                <span className="text-[30px] leading-none">{clock(positionMs)}</span>
                <span className="text-xs text-ink-3">/ {clock(durationMs)}</span>
              </div>
            </div>
          </div>
          <div className="shrink-0">{tuner ? <TunerScale value={positionMs} max={durationMs ?? 0} onChange={seek} /> : <Bar label="Position" value={positionMs} max={durationMs ?? 0} onChange={seek} className="w-full" />}</div>
          <div className="flex shrink-0 items-center justify-between">
            <Inputs track={track} />
            <Transport size="lg" />
            <div className="flex w-28 flex-col items-center gap-1">
              <VolumeControl big />
              <span className="kicker">Volume</span>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="kicker text-ink">Up next</span>
            <span className="kicker">
              {next.length} track{next.length === 1 ? '' : 's'}
            </span>
          </div>
          <ol className="flex min-h-0 flex-col overflow-y-auto">
            <li className="flex items-center gap-3 rounded-md bg-raised px-2 py-2">
              <Cover title={now.title} art={track && trackArt(track)} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-accent">{now.title}</span>
                <span className="block truncate text-xs text-ink-2">{now.artist}</span>
              </span>
              <Waveform size={14} className="text-accent" />
            </li>
            {next.length === 0 && <li className="py-6 text-center text-ink-3">Nothing after this track.</li>}
            {next.slice(0, 100).map((n) => (
              <li key={n.key}>
                <button disabled={!n.onPlay} onClick={n.onPlay} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left enabled:hover:bg-raised">
                  <Cover title={n.title} art={n.art} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                    <span className="block truncate text-xs text-ink-2">{n.artist}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}
