import { X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { artistName } from '../../shared/artistName'
import { useAwake } from '../../shared/awake'
import { bigTrackArt, trackArt } from '../../shared/art'
import { locale, tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { coverScreenMenu } from '../menus'
import { clockText, toNextMinute } from './coverClock'
import { closeCoverFull } from './coverFull'
import { songKey } from './effects'
import { useBackdrop } from './immersive'
import { Backdrop } from './NowPlaying'
import { TimeText, usePosition } from './Progress'
import { useNowTrack, usePlayer } from './store'

/** The blurred copy around the cover is at least this blurred (screen px) and veiled: the cover and the clock come first. */
const MIN_BLUR = 40
const MIN_DIM = 45
/** The pointer resting this long: the Leave button and the pointer hide (a screen to look at). */
const IDLE_MS = 2500
/** The cover's side: most of the height, room left at the sides for the clock. */
const COVER = 'min(82vh, 70vw)'

/**
 * The cover display (coverFull.ts): the cover huge over its blurred copy, title, artist and progress on its lower part,
 * the clock in a corner if asked. Right-click for the clock, Esc or a double click leaves. Keeps the display awake.
 */
export function CoverScreen() {
  const now = usePlayer((s) => s.now)
  const playing = usePlayer((s) => s.playing)
  const track = useNowTrack()
  const { backdropBlur, backdropDim, backdropMotion, coverClock, motion } = useSettings(
    useShallow((s) => ({ backdropBlur: s.settings.backdropBlur, backdropDim: s.settings.backdropDim, backdropMotion: s.settings.backdropMotion, coverClock: s.settings.coverClock, motion: s.settings.motion })),
  )
  const backdrop = useBackdrop(track ? trackArt(track)[0] : undefined, Math.max(backdropBlur, MIN_BLUR))
  const idle = useIdle(IDLE_MS)
  // The display stays on while the screen is open (a second screen showing the cover); no API: it sleeps as usual.
  useAwake(true)
  useEffect(() => {
    if (!now) closeCoverFull()
  }, [now])
  if (!now) return null
  return (
    <div role="dialog" aria-label={tr('Cover display')} onContextMenu={onMenu(coverScreenMenu)} onDoubleClick={closeCoverFull} className={`fade-in fixed inset-0 z-40 isolate grid place-items-center overflow-hidden bg-bg text-ink ${idle ? 'cursor-none' : ''}`}>
      {backdrop && <Backdrop url={backdrop} dim={Math.max(backdropDim, MIN_DIM)} motion={motion && backdropMotion} />}
      <RoundButton label={tr('Leave the cover display (Esc)')} kind="plain" size="md" onClick={closeCoverFull} className={`absolute top-4 right-4 z-10 transition-opacity duration-500 ${idle ? 'opacity-0 focus-visible:opacity-100' : ''}`}>
        <X size={22} />
      </RoundButton>
      {coverClock && <Clock />}
      {/* New song: the cover and its words fade in. */}
      <figure key={songKey(now) ?? now.title} className={`relative overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${motion ? 'fade-in' : ''}`} style={{ width: COVER, aspectRatio: '1' }}>
        <Cover title={track?.album ?? now.title} art={track && bigTrackArt(track)} size={1000} eager className="size-full! rounded-none! border-0! text-[6rem]!" />
        {/* Words on a dark fade, white: readable on any cover, any theme. */}
        <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-[0.6vh] bg-linear-to-t from-black/80 via-black/45 to-transparent px-[6%] pt-[20%] pb-[5%] text-white">
          <p className="truncate font-semibold" style={{ fontSize: 'clamp(1.25rem, 4.2vh, 3rem)' }}>
            {now.title}
          </p>
          <p className="truncate text-white/75" style={{ fontSize: 'clamp(0.9rem, 2.4vh, 1.75rem)' }}>
            {artistName(now.artist)}
          </p>
          <Line />
          <div className="flex justify-between gap-4 text-white/70" style={{ fontSize: 'clamp(0.7rem, 1.5vh, 1rem)' }}>
            <TimeText part="elapsed" />
            {!playing && <span>{tr('Paused')}</span>}
            <TimeText part="total" />
          </div>
        </figcaption>
      </figure>
    </div>
  )
}

/** The song's progress, white on the cover: ~800 steps a song, not 60 fps. */
function Line() {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(durationMs ? durationMs / 800 : 1000)
  const k = durationMs ? Math.min(1, pos / durationMs) : 0
  return (
    <span aria-hidden className="relative mt-[1vh] block h-1 overflow-hidden rounded-full bg-white/25">
      <span className="absolute inset-0 origin-left rounded-full bg-white" style={{ transform: `scaleX(${k})` }} />
    </span>
  )
}

/**
 * The clock's size: as big as the room beside the cover allows ("2:15 PM" is under 4 em wide), or above it on a tall
 * window, whichever is bigger; never over the cover (`COVER` wide, centered).
 */
const CLOCK_SIZE = `clamp(2rem, min(9vh, max((100vw - ${COVER}) / 8 - 1.5vw, (100vh - ${COVER}) / 2 - 10vh)), 7rem)`

/** The time, turning on the minute, and the day under it; in the theme's ink, over the veil. */
function Clock() {
  const [at, setAt] = useState(() => new Date())
  useEffect(() => {
    let id = 0
    const next = () => {
      id = window.setTimeout(() => {
        setAt(new Date())
        next()
      }, toNextMinute(new Date()))
    }
    next()
    return () => clearTimeout(id)
  }, [])
  const { time, day } = clockText(at, locale())
  return (
    <div className="absolute top-[4vh] left-[4vw] z-10" style={{ fontSize: CLOCK_SIZE }}>
      <p className="leading-none font-light tabular-nums">{time}</p>
      <p className="mt-[1vh] text-ink-2 first-letter:uppercase" style={{ fontSize: 'max(0.85rem, 0.26em)' }}>
        {day}
      </p>
    </div>
  )
}

/** True once the pointer has rested `ms`; any move or press shows the button and the pointer again. */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let id = window.setTimeout(() => setIdle(true), ms)
    const wake = () => {
      setIdle(false)
      clearTimeout(id)
      id = window.setTimeout(() => setIdle(true), ms)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      clearTimeout(id)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [ms])
  return idle
}
