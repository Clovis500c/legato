import { ArrowSquareOut, Heart, Queue, Quotes, SlidersHorizontal, ThumbsDown } from '@phosphor-icons/react'
import { STAGE_ID } from '../../app/searchShift'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import type { LibraryTrack, Source } from '../../shared/api'
import { bigTrackArt, trackArt } from '../../shared/art'
import { clampRatio } from '../../shared/artbox'
import type { Settings } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton, Segmented } from '../../shared/ui/controls'
import { lessLikeThis, toggleLike, useLiked } from './like'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { playerMenu } from '../menus'
import { useAmbient } from './ambient'
import { useBackdrop } from './immersive'
import { VolumeControl } from './PlayerBar'
import { SeekBar, TimeText, usePosition } from './Progress'
import { viaLabel, type Via } from './sources'
import { useStill } from './still'
import { ArtistLink } from './ArtistLink'
import { isRemote, useNowTrack, usePlayer, useVideoSlot } from './store'
import { Transport } from './Transport'
import { UpNext } from './UpNext'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { LyricsPanel } from './LyricsPanel'
import { EditorPanel } from '../editor/EditorPanel'
import { useVideoBox } from './videoBox'
import { usePulse } from './pulse'
import { Visualizer } from './Visualizer'
import { tr } from '../../shared/i18n/i18n'

/** Publishes its rect so the single YouTube iframe sits here. YouTube rules: at least 200×200, nothing on top. */
export function VideoSlot({ className = '', style, hidden = false, fill = false, live = false, onClick }: { className?: string; style?: React.CSSProperties; hidden?: boolean; fill?: boolean; live?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = useVideoSlot((s) => s.set)
  useLayoutEffect(() => {
    useVideoSlot.setState({ hidden, fill })
    return () => useVideoSlot.setState({ hidden: false, fill: false })
  }, [hidden, fill])
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
    // Ancestors too: the slot moves without resizing when its column narrows or widens (Up next opened / closed).
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) ro.observe(n)
    window.addEventListener('resize', update)
    // Capture: any scrolling ancestor moves the slot.
    window.addEventListener('scroll', update, true)
    // Now Playing rises in (np-in, 28 px): measured mid-animation, the video stayed low over the title. Again at its end.
    window.addEventListener('animationend', update, true)
    window.addEventListener('transitionend', update, true)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('animationend', update, true)
      window.removeEventListener('transitionend', update, true)
      set(null)
    }
  }, [set])
  // The iframe takes no pointer: clicks land here (our own play / pause, not YouTube's).
  return <div ref={ref} data-video-slot onClick={onClick} className={`rounded-lg bg-black ${onClick ? 'cursor-pointer' : ''} ${className}`} style={style} />
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
      <input type="range" aria-label={tr('Position')} min={0} max={max || 1} step="any" value={Math.min(value, max)} disabled={!max} onChange={(e) => onChange(+e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </div>
  )
}

const viaSource: Record<Via, Source> = { local: 'local', youtube: 'youtube', spotify: 'spotify', preview: 'apple' }

/** Where the sound comes from: one small icon. Switching source: right-click › Play via. */
function SourceBadge({ via }: { via: Via }) {
  const hint = tr('Playing from {source} · right-click to switch source', { source: tr(viaLabel[via]) })
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
function Stage({ video, cover, track, title, youtubeId, pulse }: { video: boolean; cover: boolean; track?: LibraryTrack; title: string; youtubeId?: string; pulse: boolean }) {
  const big = video && !cover
  // Cover moving with the music (Advanced, off by default).
  const coverEl = useRef<HTMLSpanElement>(null)
  usePulse(coverEl, pulse && !big)
  // Click on the picture: play / pause, our own (the embed never gets the pointer).
  const toggle = usePlayer((s) => s.toggle)
  // Cover frame takes the art's real shape (bars of video frames cut off, see Cover fit).
  const [art, setArt] = useState(1)
  // Video: same, from its own frames; the player is then enlarged and clipped to the picture (PlayerBar).
  const box = useVideoBox(big ? youtubeId : undefined)
  useEffect(() => {
    if (!big) return
    useVideoSlot.setState({ box })
    return () => useVideoSlot.setState({ box: null })
  }, [big, box])
  const ratio = big ? (box ? clampRatio((box.w * 16) / (box.h * 9)) : 16 / 9) : art
  // Container query units: fit inside both width and height, keep the ratio.
  const fit = { width: `min(100cqw, 100cqh * ${ratio})`, aspectRatio: String(ratio) }
  return (
    // w-full: parent centers its children; without it the box shrinks to nothing and cq units go to 0.
    <div className="grid min-h-50 w-full flex-1 place-items-center" style={{ containerType: 'size' }}>
      {big ? (
        // Cropped: the iframe itself stays bigger than YouTube's 200×200 minimum, the slot can be any shape.
        <VideoSlot className={box ? 'min-h-50 min-w-50 bg-transparent!' : 'min-h-50 min-w-89'} style={fit} onClick={toggle} />
      ) : (
        <span ref={coverEl} style={fit} onClick={toggle} title={tr('Play / pause')} className="relative block cursor-pointer">
          <Cover title={track?.album ?? title} art={track && bigTrackArt(track)} size={200} eager fit={setArt} className="size-full! text-[3.5rem]! shadow-[0_12px_40px_var(--shadow)]" />
          {video && <VideoSlot hidden className="absolute inset-0 bg-transparent" />}
        </span>
      )}
    </div>
  )
}

/** Drift of the immersive backdrop at t seconds: there and back in 48 s, eased (scale 1.2 → 1.35, a little shift and turn). */
export function driftTransform(t: number): string {
  const phase = (t / 48) % 2
  const x = phase < 1 ? phase : 2 - phase
  const e = x * x * (3 - 2 * x)
  const lerp = (a: number, b: number) => +(a + (b - a) * e).toFixed(4)
  return `scale(${lerp(1.2, 1.35)}) translate3d(${lerp(-3, 3)}%, ${lerp(-2, 2)}%, 0) rotate(${lerp(0, 6)}deg)`
}

/** Blurred cover layers: each new one fades in over the last, which goes once covered. Veil in the theme's color keeps text readable. */
function Backdrop({ url, dim, motion }: { url?: string; dim: number; motion: boolean }) {
  const [layers, setLayers] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!url) return
    setLayers((l) => (l[l.length - 1] === url ? l : [...l, url].slice(-2)))
    const id = setTimeout(() => setLayers((l) => l.slice(-1)), 1000)
    return () => clearTimeout(id)
  }, [url])
  // Slow drift at 15 updates a second: a CSS animation restyled the page every frame in WebView2 (~250 recalcs/s,
  // 2026-10-21 profile); at this speed a step is under a pixel.
  useEffect(() => {
    const el = box.current
    if (!motion || !el) return
    const start = performance.now()
    const id = setInterval(() => el.style.setProperty('--drift', driftTransform((performance.now() - start) / 1000)), 66)
    return () => clearInterval(id)
  }, [motion, !!url])
  if (!url) return null
  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {layers.map((u) => (
        <div key={u} className="backdrop-layer absolute -inset-[10%] bg-cover bg-center" style={{ backgroundImage: `url(${u})`, transform: motion ? 'var(--drift, scale(1.2))' : undefined }} />
      ))}
      <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--bg) ${dim}%, transparent)` }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_70%,transparent)] to-transparent" />
    </div>
  )
}

/** Settings Now Playing reads. */
const pick = ({ tuner, tint, immersive, backdropBlur, backdropDim, backdropMotion, stage, upNext, volume, coverPulse, visualizer, motion, lyrics, editor, readout }: Settings) => ({ tuner, tint, immersive, backdropBlur, backdropDim, backdropMotion, stage, upNext, volume, coverPulse, visualizer, motion, lyrics, editor, readout })

/** Tuner dial on the smooth clock: Now Playing itself doesn't re-render on every position report. */
function Tuner() {
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const pos = usePosition(durationMs ? durationMs / 400 : 1000)
  return <TunerScale value={pos} max={durationMs ?? 0} onChange={seek} />
}


type PanelId = 'upNext' | 'lyrics' | 'editor'

/** Lyrics, Up next, Sound (the Live Editor): an icon each, Fill when its panel is open beside the cover; again closes it. */
function PanelToggle({ id, label, icon: Icon, active }: { id: PanelId; label: string; icon: typeof Queue; active: PanelId | null }) {
  const on = active === id
  return (
    <RoundButton label={label} aria-pressed={on} kind="plain" size="md" className={on ? 'text-ink!' : ''} onClick={() => useSettings.getState().update(on ? { upNext: false, lyrics: false, editor: false } : { upNext: id === 'upNext', lyrics: id === 'lyrics', editor: id === 'editor' })}>
      <Icon size={22} weight={on ? 'fill' : 'regular'} />
    </RoundButton>
  )
}

/** What plays after this one; a click opens Up next. */
function NextLine() {
  const next = usePlayer((s) => {
    const at = s.order.indexOf(s.index)
    return at >= 0 && at + 1 < s.order.length ? s.list[s.order[at + 1]] : undefined
  })
  if (!next) return null
  return (
    <button onClick={() => useSettings.getState().update({ upNext: true, lyrics: false, editor: false })} title={tr('Up next')} className="-mx-2 flex w-fit max-w-full items-center gap-3 rounded-md p-2 text-left transition hover:bg-raised">
      <Cover title={next.album ?? next.title} art={trackArt(next)} size={40} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{tr('Next: {title}', { title: next.title })}</span>
        <span className="block truncate text-[0.8125rem] text-ink-2">{next.artist}</span>
      </span>
    </button>
  )
}

/**
 * Whole window (docs/design.md): the cover's flat tint, cover or video on the left, the title big on the right (or a
 * panel there: Up next, lyrics, the Live Editor, the title then over the controls), controls across the bottom.
 */
export function NowPlaying() {
  const now = usePlayer((s) => s.now)
  const setFull = usePlayer((s) => s.setFull)
  const { tuner, tint, immersive, backdropBlur, backdropDim, backdropMotion, stage, upNext, volume: volumeMode, coverPulse, visualizer, motion, lyrics, editor, readout } = useSettings(
    useShallow((s) => ({ ...pick(s.settings), theme: s.settings.theme, accent: s.settings.accent, customThemes: s.settings.customThemes, systemDark: s.systemDark })),
  )
  const update = useSettings((s) => s.update)
  // Re-rendered when the theme or accent change (selected above).
  const theme = useSettings.getState().current()
  const track = useNowTrack()
  const liked = useLiked(track)
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
  // A file, a preview: its YouTube version, if it has one, can show the video (Spotify plays in its own app).
  const ytVersion = !video && now.via !== 'spotify' && !!track?.ids.youtube
  const panel: PanelId | null = editor ? 'editor' : lyrics ? 'lyrics' : upNext ? 'upNext' : null
  const source = (
    <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
      <SourceIcon source={viaSource[now.via]} size={15} />
      {tr('Playing from {source}', { source: tr(viaLabel[now.via]) })}
    </span>
  )

  return (
    // Whole window, under the see-through top bar (logo, Close player and window buttons stay on top, z-30).
    <div role="dialog" aria-label={tr('Now playing')} onContextMenu={onMenu(playerMenu)} className="np-in fixed inset-0 z-20 isolate flex flex-col overflow-hidden bg-bg px-10 pt-17 pb-7 text-ink transition-colors duration-500" style={ambient}>
      {immersive && <Backdrop url={backdrop} dim={backdropDim} motion={backdropMotion} />}

      <div className={`grid min-h-0 flex-1 gap-12 ${panel === 'editor' ? 'grid-cols-[minmax(0,1fr)_400px]' : panel === 'upNext' ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        <section id={STAGE_ID} className="flex min-h-0 min-w-0 flex-col items-center gap-4">
          {/* Every song (user's pick 2026-10-23): Video on a file or a preview switches to its YouTube version, same spot. */}
          <Segmented
            className="glass"
            label={tr('Show')}
            value={video ? stage : stage === 'cover' ? 'cover' : 'auto'}
            onChange={(s) => {
              update({ stage: s })
              if (s === 'video' && !video && ytVersion) void usePlayer.getState().playAt(usePlayer.getState().index, 'youtube', { from: usePlayer.getState().positionMs })
            }}
            options={[{ value: 'auto', label: video && stage === 'auto' && still !== undefined ? (still ? tr('Auto · cover') : tr('Auto · video')) : tr('Auto') }, ...(video || ytVersion ? [{ value: 'video' as const, label: tr('Video') }] : []), { value: 'cover', label: tr('Cover') }]}
          />
          <Stage video={video} cover={stage === 'cover' || (stage === 'auto' && still === true)} track={track} title={now.title} youtubeId={now.youtubeId} pulse={coverPulse && motion} />
          {visualizer && motion && now.via !== 'spotify' && <Visualizer />}
          {now.via === 'spotify' && <span className="kicker text-center">{tr('Playing in your Spotify app')}</span>}
          {now.via === 'preview' && (
            <div className="flex items-center justify-center gap-4">
              <span className="kicker">{tr('30-second preview')}</span>
              {now.page && (
                <Button variant="link" className="text-xs" onClick={() => openUrl(now.page!)}>
                  {tr('Listen on Apple Music')} <ArrowSquareOut size={13} />
                </Button>
              )}
            </div>
          )}
        </section>

        {panel === 'editor' ? (
          <EditorPanel onHide={() => update({ editor: false })} />
        ) : panel === 'lyrics' ? (
          <LyricsPanel onHide={() => update({ lyrics: false })} onUpNext={() => update({ lyrics: false, upNext: true })} />
        ) : panel === 'upNext' ? (
          <UpNext onHide={() => update({ upNext: false })} />
        ) : (
          // Display XL (docs/design.md), smaller in a small window; long video titles wrap to two lines.
          <div className="flex min-w-0 flex-col justify-center gap-4 pb-8">
            <h2 className="line-clamp-2 pb-1 text-[clamp(2.5rem,5.5vw,5.5rem)] leading-[1.05] font-black tracking-[-0.02em] break-words">{now.title}</h2>
            <ArtistLink now={now} className="w-fit max-w-full truncate text-[1.375rem] leading-7 font-bold" />
            {track?.album && <p className="truncate text-sm">{track.album}</p>}
            {readout && source}
            <hr className="border-line" />
            <NextLine />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-3 pt-6">
        {panel && (
          <div className="min-w-0">
            <h2 className="truncate text-[2rem] leading-tight font-black tracking-[-0.02em]">{now.title}</h2>
            <ArtistLink now={now} className="block w-fit max-w-full truncate text-base font-medium" />
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-ink-2">
          <TimeText part="elapsed" className="w-10" />
          <div className="min-w-0 flex-1">{tuner ? <Tuner /> : <SeekBar />}</div>
          <TimeText part="remaining" className="w-10 text-right" />
        </div>
        {/* Side columns may shrink (small window): the volume bar narrows instead of running into the transport. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
          <span className="flex min-w-0 items-center gap-1">
            {track && (
              <RoundButton label={liked ? tr('Remove from Liked Music') : tr('Add to Liked Music')} aria-pressed={liked} kind="plain" size="md" onClick={() => void toggleLike(track)} className={liked ? 'text-ink!' : ''}>
                <Heart size={22} weight={liked ? 'fill' : 'regular'} />
              </RoundButton>
            )}
            {track && !isRemote(track) && <AddToPlaylist trackIds={[track.id]} label={tr('Add {title} to a playlist', { title: track.title })} />}
            {track && !isRemote(track) && (
              <RoundButton label={tr('Less like this')} kind="plain" size="md" onClick={() => lessLikeThis(track)}>
                <ThumbsDown size={22} />
              </RoundButton>
            )}
            {readout && panel && <SourceBadge via={now.via} />}
          </span>
          <Transport size="lg" />
          <div className="flex min-w-0 items-center justify-end gap-1">
            <PanelToggle id="lyrics" label={tr('Lyrics')} icon={Quotes} active={panel} />
            <PanelToggle id="upNext" label={tr('Up next')} icon={Queue} active={panel} />
            <PanelToggle id="editor" label={tr('Sound')} icon={SlidersHorizontal} active={panel} />
            <span className="flex min-w-0 flex-col items-end gap-1">
              <VolumeControl big />
              {volumeMode === 'knob' && <span className="kicker">{tr('Volume')}</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
