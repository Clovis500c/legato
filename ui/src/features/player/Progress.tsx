import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { Bar } from '../../shared/ui/controls'
import { move, press, release, shown, type Drag } from './seekDrag'
import { SHAPE_BARS, shapeBars, shapePath } from './seekShape'
import { bookmarkTime, useBookmarks } from './bookmarks'
import { useSponsor } from './sponsor'
import { usePlayer } from './store'
import { tr } from '../../shared/i18n/i18n'

const clock = (ms: number | null) => formatDuration(ms) || '0:00'
/** Seek bar resolution: under a pixel on a full-width bar. */
const BAR_STEPS = 2000

/** Position between two source reports: last report + time since, while playing. Never past the end. */
export function extrapolate(reported: number, at: number, now: number, playing: boolean, durationMs: number | null): number {
  const p = playing ? reported + Math.max(0, now - at) : reported
  return durationMs ? Math.min(p, durationMs) : p
}

/** Down to a multiple of step (ms): what a display can show. */
export function quantize(ms: number, step: number): number {
  return step > 1 ? Math.floor(ms / step) * step : Math.round(ms)
}

// Last source report (YouTube ~4/s, engine 4/s), stamped on arrival. A new song's start isn't one (live false): the
// clock waits for its source (2026-11-01: a YouTube start Google refused ran the clock, nothing playing).
let base = { ms: usePlayer.getState().positionMs, at: performance.now(), live: false }
usePlayer.subscribe((s, prev) => {
  if (s.playId !== prev.playId) base = { ms: s.positionMs, at: performance.now(), live: false }
  else if (s.positionMs !== prev.positionMs) base = { ms: s.positionMs, at: performance.now(), live: true }
})

// One frame loop for every bar and clock on screen, only while something listens (playing).
const ticks = new Set<() => void>()
let frameAt = performance.now()
let frame = 0
// About 60-80 ticks a second at most: a 144 / 240 Hz screen would otherwise run (and repaint) every bar 2-4 times as
// often for no visible gain (review 2026-10-22: 222 calls a second).
const loop = (t: number) => {
  frame = requestAnimationFrame(loop)
  if (t - frameAt < 12) return
  frameAt = t
  // One failing listener must not stop every bar.
  for (const tick of ticks) {
    try {
      tick()
    } catch (e) {
      console.error(e)
    }
  }
}
function onFrame(tick: () => void) {
  ticks.add(tick)
  if (ticks.size === 1) frame = requestAnimationFrame(loop)
  return () => {
    ticks.delete(tick)
    if (!ticks.size) cancelAnimationFrame(frame)
  }
}
const still = () => () => {}

/** Position at this instant (a click), outside React. */
export function positionNow(): number {
  const { playing, durationMs } = usePlayer.getState()
  return extrapolate(base.ms, base.at, performance.now(), playing && base.live, durationMs)
}

/**
 * Smooth position between reports. Re-renders only when it crosses `step` (ms): 1000 for a clock, a fraction of the
 * track for a bar. Every frame per component cost ~10 renders a frame at 144 Hz (2026-10-17 profile).
 */
export function usePosition(step = 1): number {
  const playing = usePlayer((s) => s.playing)
  const durationMs = usePlayer((s) => s.durationMs)
  // Reports re-render too: seeking while paused.
  usePlayer((s) => s.positionMs)
  return useSyncExternalStore(playing ? onFrame : still, () => quantize(extrapolate(base.ms, base.at, frameAt, playing && base.live, durationMs), step))
}

/** Thin line of the song's progress along a card's edge (docked and phone mini players): ~500 steps a song, not 60 fps. */
export function ProgressLine({ className = 'absolute inset-x-0 bottom-0' }: { className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(durationMs ? durationMs / 500 : 1000)
  const k = durationMs ? Math.min(1, pos / durationMs) : 0
  return (
    <span aria-hidden className={`h-0.5 bg-line-soft ${className}`}>
      <span className="absolute inset-0 origin-left bg-accent" style={{ transform: `scaleX(${k})` }} />
    </span>
  )
}

/** Shapes asked for, by file: one ask per file a session (the engine keeps them across sessions). */
const shapes = new Map<string, Promise<number[] | null>>()

/** The playing local song's shape as SVG paths (Song's shape on), else null: a stream, a file not measurable. */
function useSongShape(): string | null {
  const on = usePlayer((s) => s.songShape)
  const path = usePlayer((s) => s.now?.path)
  const [got, setGot] = useState<{ path: string; d: string | null }>()
  useEffect(() => {
    if (!on || !path) return
    let live = true
    if (!shapes.has(path)) shapes.set(path, api.localWaveform(path).catch(() => null))
    void shapes.get(path)!.then((points) => {
      const bars = points ? shapeBars(points) : []
      if (live) setGot({ path, d: bars.length ? shapePath(bars, 16) : null })
    })
    return () => {
      live = false
    }
  }, [on, path])
  return on && path && got?.path === path ? got.d : null
}

/**
 * YouTube-like seek bar fed by the smooth position. While a pointer drags it, it shows the pointer and seeks on release;
 * arrow keys seek at once. A drag never outlives its song (`seekDrag.ts`).
 */
export function SeekBar({ className = '' }: { className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const track = String(usePlayer((s) => s.playId))
  const pos = usePosition(durationMs ? durationMs / BAR_STEPS : 1000)
  const playing = usePlayer((s) => s.playing)
  const [drag, setDrag] = useState<Drag>(null)
  // Ref too: input events can arrive before React re-renders after pointerdown.
  const live = useRef<Drag>(null)
  const put = (d: Drag) => setDrag((live.current = d))
  const end = useRef(() => {})
  const shape = useSongShape()
  const played = durationMs ? Math.min(100, (shown(drag, track, pos) / durationMs) * 100) : 0

  useEffect(() => () => end.current(), [])

  return (
    <span
      className={`relative flex ${shape ? 'has-shape' : ''} ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        put(press(String(usePlayer.getState().playId), pos))
        // Released anywhere (outside the bar, outside the window) or focus lost: the drag ends.
        const finish = () => {
          end.current()
          const r = release(live.current, String(usePlayer.getState().playId))
          put(r.drag)
          if (r.seek !== null) usePlayer.getState().seek(r.seek)
        }
        end.current()
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('blur', finish)
        end.current = () => {
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('blur', finish)
          end.current = () => {}
        }
      }}
    >
      {/* Settings › Appearance › Progress bar, Wavy: the played part as a wave (styles.css; hidden otherwise). Under the bar. */}
      <span aria-hidden className="squiggle" style={{ width: `${played}%` }}>
        <span data-moving={playing} />
      </span>
      {/* Song's shape (a local song's, measured once): the unplayed bars in the line's colour, the played ones in ink. */}
      {shape && (
        <svg aria-hidden className="song-shape" viewBox={`0 0 ${SHAPE_BARS} 16`} preserveAspectRatio="none">
          <path d={shape} className="fill-line" />
          <path d={shape} className="fill-ink" style={{ clipPath: `inset(0 ${100 - played}% 0 0)` }} />
        </svg>
      )}
      <Bar
        label={tr('Position')}
        seek
        value={shown(drag, track, pos)}
        max={durationMs ?? 0}
        onChange={(v) => {
          const r = move(live.current, v)
          put(r.drag)
          if (r.seek !== null) seek(r.seek)
        }}
        className="relative w-full"
      />
      <PartMarks />
      <BookmarkMarks />
    </span>
  )
}

/** The non-music parts SponsorBlock marked, as quiet marks on the bar (none when the setting is off or nothing is marked). */
function PartMarks() {
  const on = usePlayer((s) => s.skipNonMusic && !!s.now?.youtubeId)
  const durationMs = usePlayer((s) => s.durationMs)
  const video = usePlayer((s) => s.now?.youtubeId)
  const { video: marked, segs } = useSponsor()
  if (!on || !durationMs || marked !== video || !segs.length) return null
  const total = durationMs / 1000
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 mt-[6px] h-[3px]">
      {segs
        .filter((s) => s.startS < total)
        .map((s) => (
          <span key={s.startS} title={tr('Non-music part')} className="absolute h-full rounded-full bg-ink-4" style={{ left: `${(s.startS / total) * 100}%`, width: `${((Math.min(s.endS, total) - s.startS) / total) * 100}%` }} />
        ))}
    </span>
  )
}

/** The playing song's bookmarks as small ticks above the bar. */
function BookmarkMarks() {
  const durationMs = usePlayer((s) => s.durationMs)
  const trackId = usePlayer((s) => s.now?.trackId)
  const { trackId: of, list } = useBookmarks()
  if (!durationMs || of !== trackId || !list.length) return null
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -mt-[10px] h-[5px]">
      {list
        .filter((b) => b.ms < durationMs)
        .map((b) => (
          <span key={b.id} title={b.note || bookmarkTime(b)} className="absolute h-full w-[2px] -translate-x-1/2 rounded-full bg-ink-3" style={{ left: `${(b.ms / durationMs) * 100}%` }} />
        ))}
    </span>
  )
}

/** "0:54 / 2:52" (YouTube) or elapsed / the song's length around the bar (the mockups'). */
export function TimeText({ part, className = '' }: { part: 'both' | 'elapsed' | 'total'; className?: string }) {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(1000)
  const text = part === 'both' ? `${clock(pos)} / ${clock(durationMs)}` : part === 'elapsed' ? clock(pos) : clock(durationMs)
  return <span className={`tabular-nums ${className}`}>{text}</span>
}
