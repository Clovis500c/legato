import { ArrowSquareOut, CaretDown, DotsThree, Heart, ImageSquare, Queue, Quotes, SlidersHorizontal, ThumbsDown } from '@phosphor-icons/react'
import { artistName } from '../../shared/artistName'
import { STAGE_ID } from '../../app/searchShift'
import { pop } from '../../shared/motion'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import type { LibraryTrack, Source } from '../../shared/api'
import { bigTrackArt, trackArt } from '../../shared/art'
import { clampRatio } from '../../shared/artbox'
import { coverGlow, type Settings } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { usePhone } from '../../shared/phone'
import { RoundButton, Segmented } from '../../shared/ui/controls'
import { lessLikeThis, toggleLike, useLiked } from './like'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { playerMenu, vizMenu } from '../menus'
import { useAmbient, useCoverHue } from './ambient'
import { useBackdrop } from './immersive'
import { VolumeControl } from './PlayerBar'
import { SeekBar, TimeText, usePosition } from './Progress'
import { viaLabel, type Via } from './sources'
import { useStill } from './still'
import { ArtistLink } from './ArtistLink'
import { isRemote, useNowTrack, usePlayer, useVideoSlot } from './store'
import { volumeWheelRef } from './volume'
import { Transport } from './Transport'
import { UpNext } from './UpNext'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { LyricsPanel, useNowLyrics } from './LyricsPanel'
import { songKey } from './effects'
import { applyFix, NO_FIX, peekLine } from './lyricsAt'
import { PageBoundary } from '../../app/PageBoundary'
import { EditorPanel } from '../../app/pages'
import { useVideoBox } from './videoBox'
import { VideoSlot } from './VideoSlot'
import { usePulse } from './pulse'
import { RING_COVER, RING_MIN } from './vizDraw'
import { openVizFull } from './vizFull'
import { RadialRing, VizBackdrop, Visualizer } from './Visualizer'
import { tr } from '../../shared/i18n/i18n'
import { RoomFloats, RoomPill } from '../rooms/RoomPill'
import { inRoom, useRoom } from '../rooms/room'

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

const viaSource: Record<Via, Source> = { local: 'local', server: 'server', youtube: 'youtube', spotify: 'spotify', preview: 'apple' }

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
function Stage({ video, cover, track, title, youtubeId, pulse, wantRing, onRing }: { video: boolean; cover: boolean; track?: LibraryTrack; title: string; youtubeId?: string; pulse: boolean; wantRing: boolean; onRing: (on: boolean) => void }) {
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
  // Radial look: the cover turns round and the visualizer's ring goes behind it, where the stage is big and the art square.
  const area = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState(0)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setSide(Math.min(el.clientWidth, el.clientHeight)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ring = wantRing && !big && Math.abs(art - 1) < 0.06 && side >= RING_MIN
  useEffect(() => {
    onRing(ring)
    return () => onRing(false)
  }, [ring, onRing])
  const ratio = big ? (box ? clampRatio((box.w * 16) / (box.h * 9)) : 16 / 9) : art
  // Glow: a light of the cover's own colour behind it (none when off, on a grey cover or a video).
  const dark = useSettings((s) => s.current().dark)
  const level = useSettings((s) => s.settings.glow)
  const hue = useCoverHue(level !== 'off' && !big && track ? trackArt(track)[0] : undefined, dark)
  const halo = coverGlow(hue, level, dark)
  // Container query units: fit inside both width and height, keep the ratio.
  const fit = { width: ring ? `min(${RING_COVER * 100}cqw, ${RING_COVER * 100}cqh)` : `min(100cqw, 100cqh * ${ratio})`, aspectRatio: String(ring ? 1 : ratio) }
  return (
    // w-full: parent centers its children; without it the box shrinks to nothing and cq units go to 0.
    <div ref={area} className="relative grid min-h-50 w-full flex-1 place-items-center" style={{ containerType: 'size' }}>
      {ring && (
        <div onContextMenu={onMenu(vizMenu)} onDoubleClick={openVizFull} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 'min(100cqw, 100cqh)', aspectRatio: '1' }}>
          <RadialRing />
        </div>
      )}
      {big ? (
        // Cropped: the iframe itself stays bigger than YouTube's 200×200 minimum, the slot can be any shape.
        <VideoSlot className={box ? 'min-h-50 min-w-50 bg-transparent!' : 'min-h-50 min-w-89'} style={fit} onClick={toggle} />
      ) : (
        <span ref={coverEl} style={fit} onClick={toggle} title={tr('Play / pause')} className="relative block cursor-pointer">
          {halo && <span aria-hidden className={`absolute inset-0 ${ring ? 'rounded-full' : 'rounded-cover'}`} style={{ boxShadow: halo }} />}
          <Cover title={track?.album ?? title} art={track && bigTrackArt(track)} size={200} eager fit={setArt} className={`size-full! text-[3.5rem]! shadow-[0_12px_40px_var(--shadow)] ${ring ? 'rounded-full!' : ''}`} />
          {video && <VideoSlot hidden className="absolute inset-0 bg-transparent" />}
          <RoomFloats big />
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
export function Backdrop({ url, dim, motion }: { url?: string; dim: number; motion: boolean }) {
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
    <RoundButton label={label} aria-pressed={on} kind="plain" size="md" className={on ? 'text-ink!' : ''} onClick={(e) => (useSettings.getState().update(on ? { upNext: false, lyrics: false, editor: false } : { upNext: id === 'upNext', lyrics: id === 'lyrics', editor: id === 'editor' }), pop(e.currentTarget))}>
      <Icon size={22} weight={on ? 'fill' : 'regular'} />
    </RoundButton>
  )
}

/** The mockup's peek at the lyrics: the line being sung (or the first one), or instrumental; none found = nothing. A click opens them. */
function LyricsPeek() {
  const now = usePlayer((s) => s.now)
  const { mine } = useNowLyrics()
  const song = songKey(now)
  const fix = useSettings((s) => (song && s.settings.lyricsSync[song]) || NO_FIX)
  const pos = usePosition(250)
  const l = mine?.lyrics
  const synced = useMemo(() => (l?.lines.length ? applyFix(l.lines, fix) : null), [l, fix])
  // A line shows a moment early, as in the lyrics panel.
  const line = l ? peekLine(synced ?? [], l.plain, pos + 200) || (l.instrumental ? `♪ ${tr('Instrumental')}` : '') : ''
  if (!line.trim()) return null
  return (
    <button onClick={() => useSettings.getState().update({ lyrics: true, upNext: false, editor: false })} title={tr('Lyrics')} className="-mx-2 flex w-fit max-w-full flex-col gap-1 rounded-md p-2 text-left transition hover:bg-raised">
      <span className="text-sm font-medium">{tr('Lyrics')}</span>
      <span className="line-clamp-2 text-sm text-ink-2">{line}</span>
    </button>
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
    <button onClick={() => useSettings.getState().update({ upNext: true, lyrics: false, editor: false })} title={tr('Up next')} className="-mx-2 flex w-fit max-w-full flex-col gap-2 rounded-md p-2 text-left transition hover:bg-raised">
      <span className="text-sm font-medium">{tr('Then')}</span>
      <span className="flex min-w-0 items-center gap-3">
        <Cover title={next.album ?? next.title} art={trackArt(next)} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-sm">{next.title}</span>
          <span className="block truncate text-[0.8125rem] text-ink-2">{artistName(next.artist)}</span>
        </span>
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
  // The page the queue was started from (the mockup's "Playing from Late piano").
  const from = usePlayer((s) => s.from)
  const room = useRoom((s) => inRoom(s.status))
  const setFull = usePlayer((s) => s.setFull)
  const { tuner, tint, immersive, backdropBlur, backdropDim, backdropMotion, stage, upNext, volume: volumeMode, coverPulse, visualizer, motion, lyrics, editor, readout } = useSettings(
    useShallow((s) => ({ ...pick(s.settings), theme: s.settings.theme, accent: s.settings.accent, customThemes: s.settings.customThemes, systemDark: s.systemDark })),
  )
  const update = useSettings((s) => s.update)
  const look = useSettings((s) => s.settings.visualizerStyle)
  const vizBackdrop = useSettings((s) => s.settings.visualizerBackdrop)
  // The Radial look's ring is around the cover (Stage): then the strip under it stays away.
  const [ring, setRing] = useState(false)
  // Re-rendered when the theme or accent change (selected above).
  const theme = useSettings.getState().current()
  const track = useNowTrack()
  const liked = useLiked(track)
  const ambient = useAmbient(tint && !immersive && track ? trackArt(track)[0] : undefined, theme)
  // Auto: a still-image upload shows as a cover.
  const still = useStill(now?.via === 'youtube' ? now.youtubeId : undefined)
  const backdrop = useBackdrop(immersive && track ? trackArt(track)[0] : undefined, backdropBlur)
  const phone = usePhone()

  useEffect(() => {
    // A dialog or a menu on top (share card, add to playlist…) takes this Esc: Now Playing stays.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-modal], [role="menu"]') && setFull(false)
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
  // Every song (user's pick 2026-10-23): Video on a file or a preview switches to its YouTube version, same spot.
  const show = video ? stage : stage === 'cover' ? 'cover' : 'auto'
  const showOptions = [{ value: 'auto' as const, label: video && stage === 'auto' && still !== undefined ? (still ? tr('Auto · cover') : tr('Auto · video')) : tr('Auto') }, ...(video || ytVersion ? [{ value: 'video' as const, label: tr('Video') }] : []), { value: 'cover' as const, label: tr('Cover') }]
  const pickShow = (s: typeof stage) => {
    update({ stage: s })
    if (s === 'video' && !video && ytVersion) void usePlayer.getState().playAt(usePlayer.getState().index, 'youtube', { from: usePlayer.getState().positionMs })
  }
  // More (the phone's bar, the PC's controls): the Show switch, Less like this, then the player's own menu (Karaoke,
  // Cover display, picture in picture, sleep timer…).
  const more = (): MenuEntry[] => [
    { label: tr('Show'), icon: <ImageSquare size={16} />, items: showOptions.map((o) => ({ label: o.label, checked: o.value === show, onSelect: () => pickShow(o.value) })) },
    track && !isRemote(track) && { label: tr('Less like this'), icon: <ThumbsDown size={16} />, onSelect: () => lessLikeThis(track) },
    '-',
    ...playerMenu({ controls: false }),
  ]
  const source = (
    <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
      <SourceIcon source={viaSource[now.via]} size={15} />
      {tr('Playing from {source}', { source: tr(viaLabel[now.via]) })}
    </span>
  )

  return (
    // Whole window, under the see-through top bar (logo, Close player and window buttons stay on top, z-30).
    <div role="dialog" aria-label={tr('Now playing')} onContextMenu={onMenu(playerMenu)} className="np-in fixed inset-0 z-20 isolate flex flex-col overflow-hidden bg-bg px-10 pt-17 pb-7 text-ink transition-colors duration-500 phone:px-5 phone:pt-[max(0.5rem,env(safe-area-inset-top))] phone:pb-[max(1rem,env(safe-area-inset-bottom))]" style={ambient}>
      {immersive && <Backdrop url={backdrop} dim={backdropDim} motion={backdropMotion} />}
      {visualizer && vizBackdrop && motion && now.via !== 'spotify' && <VizBackdrop />}

      {/* The phone: its own bar in place of the app's (hidden under it): close, where it plays from, More. */}
      {phone && (
        <header className="-mx-2 flex shrink-0 items-center gap-2 pb-2">
          <RoundButton label={tr('Close Now Playing (Esc)')} kind="plain" size="md" onClick={() => setFull(false)}>
            <CaretDown size={22} />
          </RoundButton>
          {room ? (
            <span className="flex min-w-0 flex-1 justify-center">
              <RoomPill />
            </span>
          ) : (
            <p className="kicker min-w-0 flex-1 truncate text-center">{from ? tr('Playing from {list}', { list: from }) : tr('Now playing')}</p>
          )}
          <RoundButton label={tr('More')} kind="plain" size="md" onClick={(e) => openMenu(e, more(), { place: 'below' })}>
            <DotsThree size={24} weight="bold" />
          </RoundButton>
        </header>
      )}

      {/* Phone layout: one column, the cover over the song; an open panel (lyrics, Up next, sound) takes the cover's place. */}
      <div className={`grid min-h-0 flex-1 gap-12 phone:grid-cols-1 phone:gap-4 ${panel ? 'phone:grid-rows-1' : 'phone:grid-rows-[minmax(0,1fr)_auto]'} ${panel === 'editor' ? 'grid-cols-[minmax(0,1fr)_400px]' : panel === 'upNext' ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        <section id={STAGE_ID} className={`flex min-h-0 min-w-0 flex-col items-center gap-4 ${panel ? 'phone:hidden' : ''}`}>
          {/* The phone: in More (one main thing on screen, the cover). The PC: only with a video to pick (a file with no
              YouTube version has Auto and Cover alike); always in More too. */}
          {!phone && (video || ytVersion) && <Segmented className="glass" label={tr('Show')} value={show} onChange={pickShow} options={showOptions} />}
          <Stage video={video} cover={stage === 'cover' || (stage === 'auto' && still === true)} track={track} title={now.title} youtubeId={now.youtubeId} pulse={coverPulse && motion} wantRing={visualizer && motion && look === 'radial' && now.via !== 'spotify'} onRing={setRing} />
          {visualizer && motion && now.via !== 'spotify' && !ring && <Visualizer />}
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
          <PageBoundary>
            <EditorPanel onHide={() => update({ editor: false })} />
          </PageBoundary>
        ) : panel === 'lyrics' ? (
          <LyricsPanel onHide={() => update({ lyrics: false })} onUpNext={() => update({ lyrics: false, upNext: true })} />
        ) : panel === 'upNext' ? (
          <UpNext onHide={() => update({ upNext: false })} />
        ) : (
          // Display XL (docs/design.md), smaller in a small window; long video titles wrap to two lines.
          phone ? (
            // The phone: title and artist on the left, the heart beside them; album, lyrics and Up next one tap away.
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-2xl leading-tight font-black tracking-[-0.02em] break-words">{now.title}</h2>
                <span className="flex min-w-0 items-center gap-1.5 text-base text-ink-2">
                  <ArtistLink now={now} className="min-w-0 truncate" />
                  {readout && <SourceIcon source={viaSource[now.via]} size={14} />}
                </span>
              </div>
              {track && (
                <RoundButton label={liked ? tr('Remove from Liked Music') : tr('Add to Liked Music')} aria-pressed={liked} kind="plain" size="md" onClick={(e) => (void toggleLike(track), pop(e.currentTarget))} className={liked ? 'text-ink!' : ''}>
                  <Heart size={24} weight={liked ? 'fill' : 'regular'} />
                </RoundButton>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col justify-center gap-4 pb-8">
              {from && <p className="kicker truncate">{tr('Playing from {list}', { list: from })}</p>}
              <h2 className="line-clamp-2 pb-1 text-[clamp(2.5rem,5.5vw,5.5rem)] leading-[1.05] font-black tracking-[-0.02em] break-words">{now.title}</h2>
              <ArtistLink now={now} className="w-fit max-w-full truncate text-[1.375rem] leading-7 font-bold" />
              {track?.album && <p className="truncate text-sm">{track.album}</p>}
              {readout && source}
              <LyricsPeek />
              <NextLine />
            </div>
          )
        )}
      </div>

      <div ref={volumeWheelRef} className="flex shrink-0 flex-col gap-3 pt-6">
        {panel && (
          <div className="min-w-0">
            <h2 className="truncate text-[2rem] leading-tight font-black tracking-[-0.02em] phone:text-xl">{now.title}</h2>
            <ArtistLink now={now} className="block w-fit max-w-full truncate text-base font-medium" />
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-ink-2">
          <TimeText part="elapsed" className="w-10" />
          <div className="min-w-0 flex-1">{tuner ? <Tuner /> : <SeekBar />}</div>
          <TimeText part="total" className="w-10 text-right" />
        </div>
        {/* Side columns may shrink (small window): the volume bar narrows instead of running into the transport. */}
        {/* Phone layout: the transport on its own row first, the rest under it; no volume (the phone's buttons). */}
        {/* The phone: the transport, then Lyrics, Up next and Sound spread under the thumb; the rest in More. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center phone:grid-cols-1 phone:gap-y-3">
          <span className="flex min-w-0 items-center gap-1 phone:hidden">
            {track && (
              <RoundButton label={liked ? tr('Remove from Liked Music') : tr('Add to Liked Music')} aria-pressed={liked} kind="plain" size="md" onClick={(e) => (void toggleLike(track), pop(e.currentTarget))} className={liked ? 'text-ink!' : ''}>
                <Heart size={22} weight={liked ? 'fill' : 'regular'} />
              </RoundButton>
            )}
            {track && !isRemote(track) && <AddToPlaylist trackIds={[track.id]} label={tr('Add {title} to a playlist', { title: track.title })} />}
            {readout && panel && <SourceBadge via={now.via} />}
          </span>
          <span className="phone:justify-self-center">
            <Transport size="lg" />
          </span>
          <div className="flex min-w-0 items-center justify-end gap-1 phone:justify-around">
            <RoomPill className="mr-1 max-w-40 phone:hidden" />
            <PanelToggle id="lyrics" label={tr('Lyrics')} icon={Quotes} active={panel} />
            <PanelToggle id="upNext" label={tr('Up next')} icon={Queue} active={panel} />
            <PanelToggle id="editor" label={tr('Sound')} icon={SlidersHorizontal} active={panel} />
            {/* Karaoke (K), Cover display (C), Less like this and the rest: one More (a calm player, plan-v2 › U2). The
                phone has its own in its top bar. */}
            <RoundButton label={tr('More')} kind="plain" size="md" className="phone:hidden" onClick={(e) => openMenu(e, more(), { place: 'above' })}>
              <DotsThree size={22} weight="bold" />
            </RoundButton>
            <span className="flex min-w-0 flex-col items-end gap-1 phone:hidden">
              <VolumeControl big />
              {volumeMode === 'knob' && <span className="kicker">{tr('Volume')}</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
