import { ArrowsIn, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useMemo, type MouseEvent } from 'react'
import { useSettings } from '../../app/settings'
import { artistName } from '../../shared/artistName'
import { bigTrackArt, trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { pipMenu } from '../menus'
import { songKey } from './effects'
import { useBackdrop } from './immersive'
import { useNowLyrics } from './LyricsPanel'
import { applyFix, lineAt, NO_FIX } from './lyricsAt'
import { Backdrop } from './Backdrop'
import { closePip, usePip } from './pipMode'
import { MiniViz } from './MiniViz'
import { SeekBar, TimeText, usePosition } from './Progress'
import { useStill } from './still'
import { useNowTrack, usePlayer } from './store'
import { Transport } from './Transport'
import { VideoSlot } from './VideoSlot'

/** Blur of the cover's copy around it (screen px): the window is small, the copy only gives a colour. */
const BLUR = 24

/**
 * Picture-in-picture (pipMode.ts): the video, or the cover over its blurred copy, filling the small window above a strip
 * of controls; nothing over the video (YouTube's rule). The picture and the strip move the window, a click on the
 * picture plays / pauses, a double click on the strip, Esc or its button go back to the full window.
 */
export function PipScreen() {
  const now = usePlayer((s) => s.now)
  const playing = usePlayer((s) => s.playing)
  const toggle = usePlayer((s) => s.toggle)
  const step = usePlayer((s) => s.step)
  const track = useNowTrack()
  const stage = useSettings((s) => s.settings.stage)
  // Vinyl covers: round here too (its box is square), else edge to edge.
  const vinyl = useSettings((s) => s.settings.covers === 'vinyl')
  const still = useStill(now?.via === 'youtube' ? now.youtubeId : undefined)
  const backdrop = useBackdrop(track ? trackArt(track)[0] : undefined, BLUR)
  const classic = usePip((s) => s.classic)
  useEffect(() => {
    if (!now) void closePip()
  }, [now])
  if (!now) return null
  // As Now Playing: Cover, or Auto on a still-image upload, shows the cover.
  const video = now.via === 'youtube' && stage !== 'cover' && !(stage === 'auto' && still === true)
  const picture = (
    <div onMouseDown={moveWindow} className={`relative grid place-items-center overflow-hidden bg-black ${classic ? 'aspect-video h-full shrink-0' : 'min-h-0 flex-1'}`} style={{ containerType: 'size' }}>
        {!video && (
          <>
            {backdrop && <Backdrop url={backdrop} dim={45} motion={false} />}
            <span key={songKey(now) ?? now.title} onClick={toggle} title={tr('Play / pause')} className="relative block max-w-[100cqw] cursor-pointer" style={{ height: '100cqh', aspectRatio: '1' }}>
              <Cover title={track?.album ?? now.title} art={track && bigTrackArt(track)} size={400} eager className={`size-full! border-0! ${vinyl ? '' : 'rounded-none!'}`} />
            </span>
          </>
        )}
        {/* Under the cover: the video plays on unseen, at YouTube's minimum size. */}
        {now.via === 'youtube' && (video ? <VideoSlot pip onClick={toggle} className="rounded-none!" style={{ width: 'min(100cqw, 100cqh * 16 / 9)', aspectRatio: '16 / 9' }} /> : <VideoSlot pip hidden className="absolute top-0 left-0 size-0" />)}
    </div>
  )
  // Settings › General › Classic mini player: the picture at YouTube's 200 px on the left, a Winamp-like strip beside.
  if (classic)
    return (
      <div role="dialog" aria-label={tr('Picture-in-picture')} onContextMenu={onMenu(pipMenu)} className="fixed inset-0 z-40 isolate flex overflow-hidden bg-bg text-ink">
        {picture}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2">
          <div onMouseDown={moveWindow} onDoubleClick={() => void closePip()} className="flex items-center gap-2">
            <TimeText part="elapsed" className="flex-1 font-mono text-2xl/8 font-semibold" />
            <RoundButton label={tr('Back to the full window (Esc)')} kind="plain" size="sm" onClick={() => void closePip()}>
              <ArrowsIn size={16} />
            </RoundButton>
          </div>
          <Marquee text={`${artistName(now.artist)} – ${now.title}`} />
          <SeekBar />
          <div className="flex justify-center">
            <Transport size="sm" />
          </div>
          <MiniViz />
        </div>
      </div>
    )
  return (
    <div role="dialog" aria-label={tr('Picture-in-picture')} onContextMenu={onMenu(pipMenu)} className="fixed inset-0 z-40 isolate flex flex-col overflow-hidden bg-bg text-ink">
      {picture}
      <SungLine />
      <Line />
      <div onMouseDown={moveWindow} onDoubleClick={() => void closePip()} className="flex h-11 shrink-0 items-center gap-0.5 pr-1.5 pl-3">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[0.8125rem] font-medium">{now.title}</p>
          <p className="truncate text-xs text-ink-2">{artistName(now.artist)}</p>
        </div>
        <RoundButton label={tr('Previous')} kind="plain" size="sm" onClick={() => step(-1)}>
          <SkipBack size={16} weight="fill" />
        </RoundButton>
        <RoundButton label={playing ? tr('Pause') : tr('Play')} kind="primary" size="sm" onClick={toggle}>
          {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </RoundButton>
        <RoundButton label={tr('Next')} kind="plain" size="sm" onClick={() => step(1)}>
          <SkipForward size={16} weight="fill" />
        </RoundButton>
        <RoundButton label={tr('Back to the full window (Esc)')} kind="plain" size="sm" onClick={() => void closePip()}>
          <ArrowsIn size={16} />
        </RoundButton>
      </div>
    </div>
  )
}

/** The classic strip's title, scrolling on a loop (still with Animations off or the system's reduced motion). */
function Marquee({ text }: { text: string }) {
  return (
    <div onMouseDown={moveWindow} title={text} className="overflow-hidden text-[0.8125rem]/5 font-medium whitespace-nowrap">
      <span className="marquee-run inline-block pr-8">{text}</span>
      <span aria-hidden className="marquee-run inline-block pr-8">
        {text}
      </span>
    </div>
  )
}

/** The line being sung (synced lyrics only, the song's own timing fix), under the picture: nothing goes over the video.
 *  Its 24 px are in `pip.rs`' smallest size, so the picture keeps YouTube's 200. */
function SungLine() {
  const now = usePlayer((s) => s.now)
  const { mine } = useNowLyrics()
  const song = songKey(now)
  const fix = useSettings((s) => (song && s.settings.lyricsSync[song]) || NO_FIX)
  const pos = usePosition(250)
  const lines = mine?.lyrics?.lines
  const synced = useMemo(() => (lines?.length ? applyFix(lines, fix) : null), [lines, fix])
  if (!synced) return null
  // A line shows a moment early, as in the lyrics panel; before the first one, its row waits empty.
  const i = lineAt(synced, pos + 200)
  return <p className="h-6 shrink-0 truncate px-3 text-center text-xs/6 font-medium text-ink-2">{i >= 0 ? synced[i].text : ''}</p>
}

/** The song's progress, a line between the picture and the strip: ~400 steps a song, not 60 fps. */
function Line() {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(durationMs ? durationMs / 400 : 1000)
  const k = durationMs ? Math.min(1, pos / durationMs) : 0
  return (
    <span aria-hidden className="relative block h-0.5 shrink-0 bg-line">
      <span className="absolute inset-0 origin-left bg-ink" style={{ transform: `scaleX(${k})` }} />
    </span>
  )
}

/** A press on the picture or the strip: moved a few px, the system drags the window (a click stays a click). */
function moveWindow(e: MouseEvent) {
  if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return
  const [x, y] = [e.screenX, e.screenY]
  const stop = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', stop)
  }
  const move = (m: globalThis.MouseEvent) => {
    if (Math.abs(m.screenX - x) + Math.abs(m.screenY - y) < 4) return
    stop()
    void getCurrentWindow()
      .startDragging()
      .catch(() => {})
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', stop)
}
