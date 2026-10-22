import { ArrowsOutSimple } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import { RoundButton } from '../../shared/ui/controls'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { playerMenu } from '../menus'
import { VideoSlot } from './NowPlaying'
import { gripCorner, nearestSpot, resized, spotPosition, type Point, type Size } from './snap'
import { useNowTrack, usePlayer } from './store'
import { Transport } from './Transport'
import { tr } from '../../shared/i18n/i18n'

// Title bar (52) and player bar (100) stay clear, 12 px gap; 24 px from the sides.
const INSETS = { top: 64, right: 24, bottom: 112, left: 24 }
const SNAP_MS = 320

const onResize = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
let view: Size = { w: window.innerWidth, h: window.innerHeight }
const viewSize = () => (view.w === window.innerWidth && view.h === window.innerHeight ? view : (view = { w: window.innerWidth, h: window.innerHeight }))

/**
 * Floating card above the bar. YouTube: always shown, the video sits in it (min 200 px tall, controls below, never on
 * top). Drag it anywhere: it settles in one of 8 spots (corners, edge middles) with a short animation. The grip on the
 * corner facing the middle resizes it.
 */
export function MiniPlayer() {
  const now = usePlayer((s) => s.now)
  const full = usePlayer((s) => s.full)
  const setFull = usePlayer((s) => s.setFull)
  const on = useSettings((s) => s.settings.miniPlayer)
  const docked = useSettings((s) => s.settings.miniPlace === 'sidebar')
  const spot = useSettings((s) => s.settings.miniSpot)
  const miniWidth = useSettings((s) => s.settings.miniWidth)
  const update = useSettings((s) => s.update)
  const track = useNowTrack()
  const win = useSyncExternalStore(onResize, viewSize)
  const [height, setHeight] = useState(268)
  const [drag, setDrag] = useState<Point | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [settling, setSettling] = useState(false)
  const gesture = useRef<{ start: Point; from: Point; last: Point; t: number; v: Point; moved: boolean; onVideo: boolean } | null>(null)
  // Card height (video + controls) for the spot math, kept current while it mounts, resizes, unmounts.
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.current.observe(el)
  }, [])

  const w = width ?? miniWidth
  const size = { w, h: height }
  const rest = spotPosition(spot, win, size, INSETS)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const settle = useCallback(() => {
    setSettling(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSettling(false), SNAP_MS + 50)
  }, [])
  // Resting spot moved (window maximized / resized, card height changed): the card glides there, the video follows it
  // frame by frame (a resize event alone only sees where the glide starts).
  useEffect(() => settle(), [rest.x, rest.y, settle])

  const video = now?.via === 'youtube'
  if (!now || full || docked || !(video || on)) return null

  const pos = drag ?? rest
  const grip = gripCorner(spot)
  const live = !!drag || width !== null || settling
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = { x: e.clientX, y: e.clientY }
    gesture.current = { start: p, from: rest, last: p, t: e.timeStamp, v: { x: 0, y: 0 }, moved: false, onVideo: e.target instanceof Element && !!e.target.closest('[data-video-slot]') }
  }
  const move = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const p = { x: e.clientX, y: e.clientY }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return
    g.moved = true
    const dt = Math.max(1, e.timeStamp - g.t)
    g.v = { x: (p.x - g.last.x) / dt, y: (p.y - g.last.y) / dt }
    g.last = p
    g.t = e.timeStamp
    setDrag({ x: g.from.x + p.x - g.start.x, y: g.from.y + p.y - g.start.y })
  }
  const up = () => {
    const g = gesture.current
    gesture.current = null
    // A click on the video (no drag): play / pause.
    if (g && !g.moved && g.onVideo) return usePlayer.getState().toggle()
    if (!g?.moved || !drag) return
    update({ miniSpot: nearestSpot(drag, g.v, win, size, INSETS) })
    setDrag(null)
    settle()
  }

  const gripDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const target = e.currentTarget
    const onMove = (m: PointerEvent) => setWidth(resized(miniWidth, m.clientX - x0, spot, win))
    const onUp = (m: PointerEvent) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      update({ miniWidth: resized(miniWidth, m.clientX - x0, spot, win) })
      setWidth(null)
      settle()
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  // Card and grip glide together to the spot; no animation while the pointer drives them.
  const glide = drag || width !== null ? '' : 'transition-[left,top] duration-300 ease-[cubic-bezier(.2,.9,.25,1)]'
  const body = (
    <div
      ref={measure}
      role="region"
      aria-label={tr('Mini player')}
      onContextMenu={onMenu(playerMenu)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ left: pos.x, top: pos.y, width: w }}
      className={`fixed z-20 flex touch-none flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_32px_var(--shadow)] select-none ${drag ? 'cursor-grabbing' : 'cursor-grab'} ${glide}`}
    >
      {video && <VideoSlot live={live} className="aspect-video w-full rounded-none" />}
      <div className="flex items-center gap-3 p-3">
        {!video && <Cover title={now.title} art={track && trackArt(track)} size={44} />}
        <button onClick={() => setFull(true)} className="min-w-0 flex-1 text-left" title={tr('Open Now Playing')}>
          <span className="block truncate text-[13px] font-semibold">{now.title}</span>
          <span className="block truncate text-xs text-ink-2">{now.artist}</span>
        </button>
        <Transport size="sm" compact />
        <RoundButton label={tr('Now playing, full screen')} kind="plain" size="sm" onClick={() => setFull(true)}>
          <ArrowsOutSimple size={13} />
        </RoundButton>
      </div>
    </div>
  )

  return (
    <>
      {body}
      {/* Resize grip: corner facing the middle of the window. Outside the card so it sits above the video (iframe z-30). */}
      <span
        role="separator"
        aria-label={tr('Resize mini player')}
        title={tr('Drag to resize')}
        onPointerDown={gripDown}
        style={{ left: grip.left ? pos.x : pos.x + w - 18, top: grip.top ? pos.y : pos.y + height - 18 }}
        className={`group fixed z-40 size-[18px] touch-none ${grip.left === grip.top ? 'cursor-nwse-resize' : 'cursor-nesw-resize'} ${glide}`}
      >
        <span className={`absolute size-2.5 rounded-[2px] border-white/80 opacity-60 group-hover:opacity-100 ${grip.top ? 'top-1 border-t-2' : 'bottom-1 border-b-2'} ${grip.left ? 'left-1 border-l-2' : 'right-1 border-r-2'}`} />
      </span>
    </>
  )
}
