import { ArrowSquareOut, CaretLeft, CaretRight, Waveform } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import type { LibraryTrack, Source } from '../../shared/api'
import { bigTrackArt, trackArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { RoundButton, Segmented } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { onMenu } from '../../shared/ui/ContextMenu'
import { playerMenu, trackMenu } from '../menus'
import { useAmbient } from './ambient'
import { useBackdrop } from './immersive'
import { useStill } from './still'
import { fileFormat, VolumeControl } from './PlayerBar'
import { viaLabel, vias, type Via } from './sources'
import { fileTitle, usePlayer, useVideoSlot } from './store'
import { SeekBar, TimeText } from './Progress'
import { Transport } from './Transport'

/** Publishes its rect so the single YouTube iframe sits here. YouTube rules: at least 200×200, nothing on top. */
export function VideoSlot({ className = '', style, hidden = false, live = false }: { className?: string; style?: React.CSSProperties; hidden?: boolean; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = useVideoSlot((s) => s.set)
  useLayoutEffect(() => {
    useVideoSlot.setState({ hidden })
    return () => useVideoSlot.setState({ hidden: false })
  }, [hidden])
  // live: slot moves without resizing (mini player drag, snap animation): follow it every frame.
  useLayoutEffect(() => {
    if (!live) return
    let id = 0
    const tick = () => {
      set(ref.current!.getBoundingClientRect())
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [live, set])
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

const viaSource: Record<Via, Source> = { local: 'local', youtube: 'youtube', spotify: 'spotify', preview: 'apple' }

/** Where the sound comes from: one small icon. Switching source: right-click › Play via. */
function SourceBadge({ via }: { via: Via }) {
  const hint = `Playing from ${viaLabel[via]} · right-click to switch source`
  return (
    <span title={hint} aria-label={hint} className="grid size-7 place-items-center text-ink-3">
      <SourceIcon source={viaSource[via]} size={15} />
    </span>
  )
}

/**
 * Video or cover, as big as the space allows without pushing the controls off screen. YouTube in cover mode (user's
 * choice 2026-10-16, against YouTube's terms like the shield): the embed keeps playing over the cover, fully transparent.
 */
function Stage({ video, cover, track, title }: { video: boolean; cover: boolean; track?: LibraryTrack; title: string }) {
  const big = video && !cover
  // Cover frame takes the art's real shape (bars of video frames cut off, see Cover fit).
  const [art, setArt] = useState(1)
  const ratio = big ? 16 / 9 : art
  // Container query units: fit inside both width and height, keep the ratio.
  const fit = { width: `min(100cqw, 100cqh * ${ratio})`, aspectRatio: String(ratio) }
  return (
    // w-full: parent centers its children; without it the box shrinks to nothing and cq units go to 0.
    <div className="grid min-h-50 w-full flex-1 place-items-center" style={{ containerType: 'size' }}>
      {big ? (
        <VideoSlot className="min-h-50 min-w-89" style={fit} />
      ) : (
        <span style={fit} className="relative block">
          <Cover title={track?.album ?? title} art={track && bigTrackArt(track)} size={200} eager fit={setArt} className="size-full! text-[56px]! shadow-[0_12px_40px_var(--shadow)]" />
          {video && <VideoSlot hidden className="absolute inset-0 bg-transparent" />}
        </span>
      )}
    </div>
  )
}

/** Blurred cover layers: each new one fades in over the last, which goes once covered. Veil in the theme's color keeps text readable. */
function Backdrop({ url, dim, motion }: { url?: string; dim: number; motion: boolean }) {
  const [layers, setLayers] = useState<string[]>([])
  useEffect(() => {
    if (!url) return
    setLayers((l) => (l[l.length - 1] === url ? l : [...l, url].slice(-2)))
    const id = setTimeout(() => setLayers((l) => l.slice(-1)), 1000)
    return () => clearTimeout(id)
  }, [url])
  if (!url) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {layers.map((u) => (
        <div key={u} className={`backdrop-layer absolute -inset-[10%] bg-cover bg-center ${motion ? '' : '[animation-name:fade-in]!'}`} style={{ backgroundImage: `url(${u})` }} />
      ))}
      <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--bg) ${dim}%, transparent)` }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_70%,transparent)] to-transparent" />
    </div>
  )
}

export function NowPlaying() {
  const { now, positionMs, durationMs, seek, setFull, list, index, order, upcoming, playAt } = usePlayer()
  const { tuner, tint, immersive, backdropBlur, backdropDim, backdropMotion, stage, upNext, volume: volumeMode } = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  // Re-rendered by the settings subscription above.
  const theme = useSettings.getState().current()
  const track = useStore((s) => s.tracks.find((t) => t.id === now?.trackId))
  const sp = useStore((s) => s.status.spotify.connected)
  const ambient = useAmbient(tint && !immersive && track ? trackArt(track)[0] : undefined, theme)
  // Auto: a still-image upload shows as a cover.
  const still = useStill(now?.via === 'youtube' ? now.youtubeId : undefined)
  const backdrop = useBackdrop(immersive && track ? trackArt(track)[0] : undefined, backdropBlur)

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
    ? order.slice(at + 1).flatMap((i) => (list[i] && vias(list[i], sp).length ? [{ key: `${i}`, title: list[i].title, artist: list[i].artist, art: trackArt(list[i]), duration: formatDuration(list[i].durationMs), onPlay: () => playAt(i), menu: onMenu(() => trackMenu(list[i], { list, index: i, queueIndex: i })) }] : []))
    : upcoming.map((p) => ({ key: p, title: fileTitle(p), artist: fileFormat(p) ?? '', art: [], duration: '', onPlay: undefined, menu: undefined }))

  const panel = (
    <aside className="flex min-h-0 flex-col gap-2 rounded-2xl border border-line-soft bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] p-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-semibold">Up next</span>
        <span className="kicker flex-1">
          {next.length} track{next.length === 1 ? '' : 's'}
        </span>
        <RoundButton label="Hide up next" kind="plain" size="sm" onClick={() => update({ upNext: false })}>
          <CaretRight size={14} />
        </RoundButton>
      </div>
      <ol className="flex min-h-0 flex-col overflow-y-auto">
        <li className="flex items-center gap-3 rounded-lg bg-accent-soft px-2 py-2">
          <Cover title={now.title} art={track && trackArt(track)} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-accent">{now.title}</span>
            <span className="block truncate text-xs text-ink-2">{now.artist}</span>
          </span>
          <Waveform size={14} className="shrink-0 text-accent" />
        </li>
        {next.length === 0 && <li className="py-6 text-center text-ink-3">Nothing after this track.</li>}
        {next.slice(0, 100).map((n) => (
          <li key={n.key} onContextMenu={n.menu}>
            <button disabled={!n.onPlay} onClick={n.onPlay} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-raised">
              <Cover title={n.title} art={n.art} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                <span className="block truncate text-xs text-ink-2">{n.artist}</span>
              </span>
              {n.duration && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{n.duration}</span>}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )

  return (
    // Below the app's title bar: navigation, window buttons and "Close player" stay reachable.
    <div role="dialog" aria-label="Now playing" onContextMenu={onMenu(playerMenu)} className="fixed inset-x-0 top-13 bottom-0 z-20 isolate flex flex-col overflow-hidden border-t border-line-soft bg-bg px-10 pt-4 pb-7 text-ink transition-colors duration-500" style={ambient}>
      {immersive && <Backdrop url={backdrop} dim={backdropDim} motion={backdropMotion} />}
      {!upNext && (
        <Button variant="ghost" className="absolute top-4 right-10 z-10" onClick={() => update({ upNext: true })}>
          <CaretLeft size={13} /> Up next · {next.length}
        </Button>
      )}

      <div className={`grid min-h-0 flex-1 gap-10 ${upNext ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'}`}>
        <section className="flex min-h-0 min-w-0 flex-col items-center gap-4">
          {video ? <Segmented label="Show" value={stage} onChange={(s) => update({ stage: s })} options={[{ value: 'auto', label: still === undefined || stage !== 'auto' ? 'Auto' : still ? 'Auto · cover' : 'Auto · video' }, { value: 'video', label: 'Video' }, { value: 'cover', label: 'Cover' }]} /> : <span className="kicker text-ink-2">Now playing · {viaLabel[now.via]}</span>}
          <Stage video={video} cover={stage === 'cover' || (stage === 'auto' && still === true)} track={track} title={now.title} />
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
          {/* Controls in one centered column, not stretched across the window. */}
          <div className="flex w-full max-w-[880px] shrink-0 flex-col gap-4">
            <div className="flex items-end justify-between gap-6">
              <div className="min-w-0">
                <h2 className="truncate text-[28px] leading-tight font-bold tracking-[-0.02em]">{now.title}</h2>
                <p className="truncate text-sm text-ink-2">{track?.album ? `${now.artist} — ${track.album}` : now.artist}</p>
              </div>
              {track && <AddToPlaylist trackIds={[track.id]} label={`Add ${track.title} to a playlist`} />}
            </div>
            <div className="flex flex-col gap-1.5">
              {tuner ? <TunerScale value={positionMs} max={durationMs ?? 0} onChange={seek} /> : <SeekBar />}
              <TimeText part="both" className="text-[13px] text-ink-2" />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <SourceBadge via={now.via} />
              <Transport size="lg" />
              <div className="flex flex-col items-end gap-1">
                <VolumeControl big />
                {volumeMode === 'knob' && <span className="kicker">Volume</span>}
              </div>
            </div>
          </div>
        </section>

        {upNext && panel}
      </div>
    </div>
  )
}
