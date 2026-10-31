import { ArrowCounterClockwise, MusicNotesSimple, X } from '@phosphor-icons/react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { trackArt } from '../../shared/art'
import { artistName } from '../../shared/artistName'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { karaokeMenu } from '../menus'
import { songKey } from './effects'
import { useBackdrop } from './immersive'
import { closeKaraoke } from './karaokeMode'
import { centerShift, plainShift, seatOf, type Seat } from './karaokeLines'
import { applyFix, fixLabel, lineAt, lineEnd, NO_FIX, withBreaks, type LyricsFix, type Timed } from './lyricsAt'
import { Sung, useNowLyrics } from './LyricsPanel'
import { Backdrop } from './NowPlaying'
import { SeekBar, TimeText, usePosition } from './Progress'
import { useNowTrack, usePlayer } from './store'

/** A line shows this early, as in the lyrics panel. */
const LEAD_MS = 200
/** The blurred cover is at least this blurred (screen px) and dimmed: the words come first. */
const MIN_BLUR = 40
const MIN_DIM = 55
/** Opacity per seat: the line sung full, the next two dimmed, the one just sung fading. */
const SEAT_OPACITY: Record<Seat, number> = { past: 0.28, now: 1, next: 0.55, later: 0.3, hidden: 0 }
const FADE_EDGES = '[mask-image:linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent)]'

/** Size of an element (px), kept in step with the window. */
function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

const Line = memo(function Line({ text, seat, calm, start, end }: { text: string; seat: Seat; calm: boolean; start: number; end: number }) {
  return (
    <p
      aria-hidden={seat === 'hidden'}
      className="my-[2.2vh] px-[8vw] text-center text-[clamp(2rem,5.2vw,5.5rem)] leading-[1.12] font-black tracking-[-0.02em] text-balance"
      style={{
        opacity: SEAT_OPACITY[seat],
        // Reduced motion / animations off: no zoom, the words cross-fade.
        transform: calm || seat === 'now' ? undefined : 'scale(0.84)',
        transition: calm ? 'opacity 400ms ease' : 'opacity 500ms ease, transform 600ms cubic-bezier(0.22, 0.8, 0.2, 1)',
      }}
    >
      {!text ? (
        <MusicNotesSimple size={56} weight="bold" aria-label={tr('Instrumental')} className={seat === 'now' && !calm ? 'inline animate-pulse' : 'inline'} />
      ) : seat === 'now' && !calm ? (
        <Sung text={text} start={start} end={end} />
      ) : (
        text
      )}
    </p>
  )
})

/** Synced lyrics: every line in one column, moved so the sung line is in the middle (a transform; nothing reflows). */
function Lines({ lines: sung, durationMs, fix, calm }: { lines: Timed[]; durationMs: number | null; fix: LyricsFix; calm: boolean }) {
  const lines = useMemo(() => withBreaks(applyFix(sung, fix), durationMs), [sung, fix, durationMs])
  const pos = usePosition(100)
  const at = lineAt(lines, pos + LEAD_MS)
  const focus = Math.max(0, at)
  const view = useRef<HTMLDivElement>(null)
  const col = useRef<HTMLDivElement>(null)
  const { w, h } = useBox(view)
  const [shift, setShift] = useState<number>()
  useLayoutEffect(() => {
    const line = col.current?.children[focus] as HTMLElement | undefined
    if (line && h) setShift(centerShift(h, line.offsetTop, line.offsetHeight))
  }, [focus, w, h, lines])
  return (
    <div ref={view} className={`relative min-h-0 flex-1 overflow-hidden ${FADE_EDGES}`}>
      <div
        ref={col}
        className="absolute inset-x-0 top-0"
        // Placed before it is seen: no slide in from the top at the start of a song.
        style={{ transform: `translate3d(0, ${shift ?? 0}px, 0)`, opacity: shift === undefined ? 0 : 1, transition: shift === undefined || calm ? undefined : 'transform 650ms cubic-bezier(0.22, 0.8, 0.2, 1)' }}
      >
        {lines.map((l, i) => {
          const seat = seatOf(i, at)
          return <Line key={i} text={l.text} seat={seat} calm={calm} start={l.ms} end={seat === 'now' ? lineEnd(lines, i, durationMs) : 0} />
        })}
      </div>
    </div>
  )
}

/** Lyrics without timings: the text glides up with the song (where it is in the song is about where it is in the text). */
function Plain({ text, durationMs, calm }: { text: string; durationMs: number | null; calm: boolean }) {
  const pos = usePosition(500)
  const view = useRef<HTMLDivElement>(null)
  const col = useRef<HTMLParagraphElement>(null)
  const { h } = useBox(view)
  const { h: colH } = useBox(col)
  return (
    <div ref={view} className={`relative min-h-0 flex-1 overflow-hidden ${FADE_EDGES}`}>
      <p
        ref={col}
        className="absolute inset-x-0 top-0 px-[10vw] py-[40vh] text-center text-[clamp(1.5rem,3vw,3rem)] leading-relaxed font-semibold whitespace-pre-line text-ink"
        style={{ transform: `translate3d(0, ${plainShift(pos, durationMs, colH, h)}px, 0)`, transition: calm ? undefined : 'transform 600ms linear' }}
      >
        {text}
      </p>
    </div>
  )
}

/** A calm word where the lyrics would be. */
const Calm = ({ children }: { children: ReactNode }) => <div className="m-auto flex max-w-[34rem] flex-col items-center gap-4 px-6 text-center text-xl font-semibold text-ink-2">{children}</div>

/**
 * Karaoke mode (K): the window in full screen, the lyrics big over the blurred cover. The line sung in the middle and
 * filled word by word, the next two dimmed, the one just sung fading; plain lyrics glide with the song. Arrows move
 * the timing (the lyrics panel's fix, same saved value), Esc leaves (karaoke.ts). It stays open across songs: the next
 * song's lyrics fill in when they come. Nothing runs here once it is closed.
 */
export function Karaoke() {
  const now = usePlayer((s) => s.now)
  const track = useNowTrack()
  const signedIn = useStore((s) => s.status.youtube.connected)
  const { mine, key, durationMs, retry } = useNowLyrics()
  const { backdropBlur, backdropDim, motion } = useSettings(useShallow((s) => ({ backdropBlur: s.settings.backdropBlur, backdropDim: s.settings.backdropDim, motion: s.settings.motion })))
  const calm = !motion || matchMedia('(prefers-reduced-motion: reduce)').matches
  const backdrop = useBackdrop(track ? trackArt(track)[0] : undefined, Math.max(backdropBlur, MIN_BLUR))
  const song = songKey(now)
  const fix = useSettings((s) => (song && s.settings.lyricsSync[song]) || NO_FIX)
  // The timing shows a moment after each nudge (and stays while it is not zero).
  const [flash, setFlash] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    setFlash(true)
    const id = setTimeout(() => setFlash(false), 1500)
    return () => clearTimeout(id)
  }, [fix])
  useEffect(() => {
    if (!now) closeKaraoke()
  }, [now])

  const l = mine?.lyrics
  return (
    <div role="dialog" aria-label={tr('Karaoke')} onContextMenu={onMenu(karaokeMenu)} className="fade-in fixed inset-0 z-40 isolate flex flex-col overflow-hidden bg-bg pt-6 text-ink">
      {backdrop && <Backdrop url={backdrop} dim={Math.max(backdropDim, MIN_DIM)} motion={false} />}
      <RoundButton label={tr('Leave Karaoke (Esc)')} kind="plain" size="md" onClick={closeKaraoke} className="absolute top-4 right-4 z-10">
        <X size={22} />
      </RoundButton>
      {!mine || (!('lyrics' in mine) && !mine.error) ? (
        <Calm>{tr('Looking for lyrics…')}</Calm>
      ) : mine.error ? (
        <Calm>
          {tr('Lyrics can’t be loaded right now.')}
          <button onClick={retry} className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink hover:bg-raised">
            <ArrowCounterClockwise size={14} /> {tr('Try again')}
          </button>
        </Calm>
      ) : !l ? (
        <Calm>{signedIn ? tr('No lyrics found for this song (searched LRCLIB and YouTube Music).') : tr('No lyrics found for this song (searched LRCLIB).')}</Calm>
      ) : l.lines.length ? (
        <Lines key={key} lines={l.lines} durationMs={durationMs} fix={fix} calm={calm} />
      ) : l.plain ? (
        <Plain key={key} text={l.plain} durationMs={durationMs} calm={calm} />
      ) : (
        <Calm>♪ {tr('Instrumental')}</Calm>
      )}
      {now && (
        <footer className="flex shrink-0 flex-col gap-2 px-[8vw] pt-3 pb-6">
          <div className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{now.title}</p>
              <p className="truncate text-xs text-ink-2">{artistName(now.artist)}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-3 tabular-nums">{(flash || fix.offset !== 0 || fix.rate !== 1) && fixLabel(fix)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-2">
            <TimeText part="elapsed" className="w-10" />
            <div className="min-w-0 flex-1">
              <SeekBar />
            </div>
            <TimeText part="total" className="w-10 text-right" />
          </div>
          <p className="text-center text-[0.6875rem] text-ink-3">{tr('← → move the lyrics · Esc leaves')}</p>
        </footer>
      )}
    </div>
  )
}
