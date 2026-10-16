import { CaretDoubleDown, Lock, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { Bar, Led, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { clock, fileFormat, VolumeControl } from './PlayerBar'
import { fileTitle, usePlayer, useVideoSlot } from './store'

/** Publishes its rect so the single YouTube iframe sits here. */
function VideoSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const set = useVideoSlot((s) => s.set)
  useLayoutEffect(() => {
    const el = ref.current!
    const update = () => set(el.getBoundingClientRect())
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      set(null)
    }
  }, [set])
  return <div ref={ref} className="aspect-video w-full rounded-lg bg-black" />
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

/** Which inputs this track has, and which one plays. Indicators only: switching comes with phase 4. */
function Inputs({ youtube, local, spotify, playing }: { youtube: boolean; local: boolean; spotify: boolean; playing: 'youtube' | 'local' }) {
  const items = [
    { code: 'YT', source: 'youtube' as const, has: youtube, on: playing === 'youtube' },
    { code: 'LOC', source: 'local' as const, has: local, on: playing === 'local' },
    { code: 'SP', source: 'spotify' as const, has: spotify, on: false, locked: true },
  ]
  return (
    <div className="flex flex-col gap-2">
      <span className="kicker">Input</span>
      <div className="flex gap-3">
        {items.map((i) => (
          <div key={i.code} className="flex flex-col items-center gap-1.5" title={i.locked ? 'Spotify: Premium required' : i.has ? 'Available' : 'Not on this source'}>
            <Led on={i.on} />
            <span className={`grid size-10 place-items-center rounded-full border ${i.on ? 'border-ink-3 bg-raised text-ink' : 'border-line'} ${i.has ? 'text-ink-2' : 'text-ink-4'}`}>
              {i.locked ? <Lock size={14} /> : <SourceIcon source={i.source} size={14} />}
            </span>
            <span className={`font-mono text-[9px] tracking-[0.08em] ${i.on ? 'text-ink' : 'text-ink-3'}`}>{i.code}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NowPlaying() {
  const { now, playing, positionMs, durationMs, toggle, seek, step, setFull, list, index, upcoming, playTracks } = usePlayer()
  const tuner = useSettings((s) => s.settings.tuner)
  const track = useStore((s) => s.tracks.find((t) => t.id === now?.trackId))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFull])
  useEffect(() => {
    if (!now) setFull(false)
  }, [now, setFull])
  if (!now) return null

  const local = !now.youtubeId
  const next = local ? upcoming.map((p) => ({ key: p, title: fileTitle(p), artist: fileFormat(p) ?? '', onPlay: undefined })) : list.slice(index + 1).flatMap((t, i) => (t.ids.youtube ? [{ key: String(t.id), title: t.title, artist: t.artist, onPlay: () => playTracks(list, index + 1 + i) }] : []))

  return (
    <div role="dialog" aria-label="Now playing" className="fixed inset-0 z-20 flex flex-col bg-bg px-10 pb-7">
      <div data-tauri-drag-region className="flex h-14 shrink-0 items-center justify-between">
        <div className="flex w-60 items-center gap-2.5">
          <RoundButton label="Collapse (Esc)" size="sm" onClick={() => setFull(false)}>
            <CaretDoubleDown size={14} />
          </RoundButton>
          <span className="kicker">Collapse</span>
        </div>
        <span className="kicker text-ink-2">Now playing · {local ? 'local file' : 'YouTube'}</span>
        <span className="w-60" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-10 pt-2">
        <section className="flex min-w-0 flex-col gap-5">
          {local ? (
            <div className="grid aspect-video w-full place-items-center rounded-lg border border-line bg-recess">
              <Cover title={now.title} size={180} />
            </div>
          ) : (
            <VideoSlot />
          )}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 className="truncate text-[32px] leading-tight font-bold tracking-[-0.03em]">{now.title}</h2>
              <p className="truncate text-sm text-ink-2">{track?.album ? `${now.artist} — ${track.album}` : now.artist}</p>
            </div>
            <div className="flex shrink-0 items-end gap-2 rounded-md border border-line-soft bg-recess px-3.5 py-2 font-mono tabular-nums">
              <span className="text-[30px] leading-none">{clock(positionMs)}</span>
              <span className="text-xs text-ink-3">/ {clock(durationMs)}</span>
            </div>
          </div>
          {tuner ? <TunerScale value={positionMs} max={durationMs ?? 0} onChange={seek} /> : <Bar label="Position" value={positionMs} max={durationMs ?? 0} onChange={seek} className="w-full" />}
          <div className="flex items-center justify-between">
            <Inputs youtube={!!(track?.ids.youtube ?? now.youtubeId)} local={local || !!track?.ids.local} spotify={!!track?.ids.spotify} playing={local ? 'local' : 'youtube'} />
            <div className="flex items-center gap-4">
              <RoundButton label="Previous" kind="soft" size="lg" onClick={() => step(-1)}>
                <SkipBack weight="fill" size={18} />
              </RoundButton>
              <RoundButton label={playing ? 'Pause' : 'Play'} kind="primary" size="xl" onClick={toggle}>
                {playing ? <Pause weight="fill" size={28} /> : <Play weight="fill" size={28} />}
              </RoundButton>
              <RoundButton label="Next" kind="soft" size="lg" onClick={() => step(1)}>
                <SkipForward weight="fill" size={18} />
              </RoundButton>
            </div>
            <div className="flex w-28 flex-col items-center gap-1">
              <VolumeControl big />
              <span className="kicker">Volume</span>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="kicker text-ink">Up next</span>
            <span className="kicker">{next.length} track{next.length > 1 ? 's' : ''}</span>
          </div>
          <ol className="flex min-h-0 flex-col overflow-y-auto">
            {next.length === 0 && <li className="py-6 text-center text-ink-3">Nothing after this track.</li>}
            {next.slice(0, 50).map((n) => (
              <li key={n.key}>
                <button disabled={!n.onPlay} onClick={n.onPlay} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left enabled:hover:bg-raised">
                  <Cover title={n.title} size={36} />
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
