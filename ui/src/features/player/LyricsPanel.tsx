import { ArrowCounterClockwise, CaretLeft, CaretRight, MusicNotesSimple, Queue, Timer } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Lyrics } from '../../shared/api'
import { RoundButton } from '../../shared/ui/controls'
import { songKey } from './effects'
import { applyFix, fixFromTaps, lineAt, lineEnd, NO_FIX, withBreaks, wordTimes, type LyricsFix } from './lyricsAt'
import { positionNow, usePosition } from './Progress'
import { useNowTrack, usePlayer } from './store'
import { CARD } from './UpNext'
import { tr } from '../../shared/i18n/i18n'

/** Lines light up this much early: a line shows as it's sung, not after. */
const LEAD_MS = 200
/** A hand on the scroll wins for this long. */
const HAND_MS = 4000

/** A tap comes this late after the line is heard (reaction time): taken off. */
const REACTION_MS = 150
/** ± buttons move the lyrics by this much. */
const NUDGE_MS = 500

/** Off by more than this from the song (seek, stall): the fill jumps to where the song is. */
const RESYNC_MS = 250

/**
 * The line being sung, filled word by word as the song goes (karaoke), softly glowing. One animation per word on the
 * compositor's clock (smooth every frame); position reports only correct it when it's really off, never every tick
 * (that made it shake).
 */
function Sung({ text, start, end }: { text: string; start: number; end: number }) {
  const pos = usePosition(250)
  const playing = usePlayer((s) => s.playing)
  const box = useRef<HTMLSpanElement>(null)
  const anims = useRef<Animation[]>([])
  const words = useMemo(() => wordTimes(text, start, end), [text, start, end])
  useEffect(() => {
    const spans = [...(box.current?.children ?? [])]
    anims.current = spans.map((el, i) =>
      el.animate([{ '--fill': '0%' }, { '--fill': '100%' }], { duration: Math.max(1, words[i].t1 - words[i].t0), delay: words[i].t0 - start, fill: 'both', easing: 'linear' }),
    )
    return () => anims.current.forEach((a) => a.cancel())
  }, [words, start])
  useEffect(() => {
    const want = pos + LEAD_MS - start
    for (const a of anims.current) {
      if (Math.abs(Number(a.currentTime ?? 0) - want) > RESYNC_MS) a.currentTime = want
      // play() on a finished word would start it over (two parts lit at once): only out of a pause.
      if (playing && a.playState === 'paused') a.play()
      else if (!playing && a.playState === 'running') a.pause()
    }
  }, [pos, playing, start])
  return (
    <span ref={box} className="drop-shadow-[0_0_14px_color-mix(in_srgb,var(--ink)_30%,transparent)]">
      {words.map((w, i) => (
        <span key={i} className="sung">
          {w.word}
        </span>
      ))}
    </span>
  )
}

/**
 * Synced lines: the current one filled as it's sung and kept in the middle; click a line to go there. ♪ where nothing
 * is sung.
 */
function Synced({ lines: sung, durationMs, fix, onTap }: { lines: Lyrics['lines']; durationMs: number | null; fix: LyricsFix; onTap?: (lyricMs: number) => void }) {
  // lyricMs: the line's own time, for "starts now" taps whatever the fix.
  const lines = useMemo(() => withBreaks(applyFix(sung.map((l) => ({ ...l, lyricMs: l.ms })), fix), durationMs), [sung, fix, durationMs])
  const pos = usePosition(100)
  const seek = usePlayer((s) => s.seek)
  const at = lineAt(lines, pos + LEAD_MS)
  const box = useRef<HTMLDivElement>(null)
  const hand = useRef(0)
  useEffect(() => {
    const el = box.current
    const line = el?.querySelector<HTMLElement>(`[data-line="${Math.max(0, at)}"]`)
    if (!el || !line || performance.now() - hand.current < HAND_MS) return
    el.scrollTo({ top: line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' })
  }, [at])
  const touched = () => void (hand.current = performance.now())
  return (
    <div ref={box} onWheel={touched} onPointerDown={touched} onKeyDown={touched} className="no-scrollbar relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-2 pb-6">
      {lines.map((l, i) => (
        <button
          key={i}
          data-line={i}
          onClick={() => {
            // ♪ breaks (added here) have no lyric time: nothing to tap.
            const lyricMs = (l as { lyricMs?: number }).lyricMs
            if (!onTap) seek(l.ms)
            else if (l.text && lyricMs !== undefined) onTap(lyricMs)
          }}
          className={`block w-full origin-left py-1.5 text-left text-[1.625rem] leading-snug font-bold tracking-[-0.01em] transition-[color,transform,opacity] duration-300 ${i === at ? 'scale-[1.03] text-ink' : i < at ? 'text-ink-2 opacity-70 hover:opacity-100' : 'text-ink-3 hover:text-ink-2'}`}
        >
          {!l.text ? (
            <MusicNotesSimple size={26} weight="bold" aria-label={tr('Instrumental')} className={i === at ? 'animate-pulse' : ''} />
          ) : i === at ? (
            <Sung text={l.text} start={l.ms} end={lineEnd(lines, i, durationMs)} />
          ) : (
            l.text
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Lyrics without timings: they glide along with the song (where it is in the song ≈ where it is in the text), a hand
 * on the scroll wins for a while. Better than a still wall of text (user's report 2026-10-22).
 */
function Plain({ text, durationMs }: { text: string; durationMs: number | null }) {
  const pos = usePosition(500)
  const box = useRef<HTMLDivElement>(null)
  const hand = useRef(0)
  useEffect(() => {
    const el = box.current
    if (!el || !durationMs || performance.now() - hand.current < HAND_MS) return
    // Half a screen of lead: the part being sung sits near the middle.
    const room = el.scrollHeight - el.clientHeight
    el.scrollTo({ top: Math.max(0, Math.min(room, (pos / durationMs) * el.scrollHeight - el.clientHeight / 2)), behavior: 'smooth' })
  }, [pos, durationMs])
  const touched = () => void (hand.current = performance.now())
  return (
    <div ref={box} onWheel={touched} onPointerDown={touched} onKeyDown={touched} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 py-4">
      <p className="text-[1.25rem] leading-relaxed font-semibold whitespace-pre-line text-ink-2">{text}</p>
    </div>
  )
}

/**
 * Now Playing › Lyrics, beside the cover (Spotify-like). LRCLIB first (synced when it can be, stretched for slowed /
 * sped up versions), YouTube Music's own when signed in (src-tauri lyrics), cached on disk.
 */
/** heading = what heads the panel instead of "Lyrics" (the main window's tabs, which also reach Up next). */
export function LyricsPanel({ onHide, onUpNext, className = CARD, heading }: { onHide: () => void; onUpNext: () => void; className?: string; heading?: ReactNode }) {
  const now = usePlayer((s) => s.now)
  const playerMs = usePlayer((s) => s.durationMs)
  const track = useNowTrack()
  const signedIn = useStore((s) => s.status.youtube.connected)
  const title = now?.title ?? ''
  const artist = now?.artist ?? ''
  // The duration decides slowed timings: wait for it a moment.
  const durationMs = track?.durationMs ?? playerMs ?? null
  const [waited, setWaited] = useState(false)
  const [got, setGot] = useState<{ for: string; lyrics?: Lyrics | null; error?: string }>()
  const [retry, setRetry] = useState(0)
  // Asked again when the length becomes known (slowed versions need it to fit the timings).
  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const key = `${artist}|${title}|${seconds}`
  useEffect(() => {
    setWaited(false)
    const id = setTimeout(() => setWaited(true), 1500)
    return () => clearTimeout(id)
  }, [key])
  const ready = !!title && (durationMs !== null || waited)
  useEffect(() => {
    if (!ready) return
    let live = true
    setGot({ for: key })
    api
      .lyrics({ title, artist, album: track?.album ?? null, durationMs, youtube: now?.youtubeId ?? track?.ids.youtube ?? null })
      .then((lyrics) => live && setGot({ for: key, lyrics }))
      .catch((e) => live && setGot({ for: key, error: String(e) }))
    return () => {
      live = false
    }
  }, [key, ready, retry]) // once per song (and per retry)

  // Timing fixed by hand for this song (Settings, synced with the other PCs).
  const song = songKey(now)
  const fix = useSettings((s) => (song && s.settings.lyricsSync[song]) || NO_FIX)
  const [tuning, setTuning] = useState(false)
  const taps = useRef<{ lyric: number; song: number }[]>([])
  useEffect(() => {
    setTuning(false)
    taps.current = []
  }, [key])
  const saveFix = (f: LyricsFix | null) => {
    if (!song) return
    const all = { ...useSettings.getState().settings.lyricsSync }
    if (f && (f.offset || f.rate !== 1)) all[song] = f
    else delete all[song]
    useSettings.getState().update({ lyricsSync: all })
  }
  const tap = (lyric: number) => {
    taps.current = [...taps.current, { lyric, song: positionNow() - REACTION_MS }]
    saveFix(fixFromTaps(taps.current, fix))
  }

  const mine = got?.for === key ? got : undefined
  const l = mine?.lyrics
  return (
    <aside aria-label={tr('Lyrics')} className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 px-1">
        <span className="flex min-w-0 flex-1 items-center text-[0.8125rem] font-semibold">{heading ?? tr('Lyrics')}</span>
        {!!l?.lines.length && song && (
          <RoundButton
            label={tr('Fix the timing')}
            kind="plain"
            size="sm"
            aria-pressed={tuning}
            className={tuning ? 'bg-ink! text-bg!' : ''}
            onClick={() => {
              taps.current = []
              setTuning(!tuning)
            }}
          >
            <Timer size={14} />
          </RoundButton>
        )}
        {!heading && (
          <RoundButton label={tr('Show Up next instead')} kind="plain" size="sm" onClick={onUpNext}>
            <Queue size={14} />
          </RoundButton>
        )}
        <RoundButton label={tr('Hide lyrics')} kind="plain" size="sm" onClick={onHide}>
          <CaretRight size={14} />
        </RoundButton>
      </div>
      {!mine || (!('lyrics' in mine) && !mine.error) ? (
        <p className="m-auto text-sm text-ink-2">{tr('Looking for lyrics…')}</p>
      ) : mine.error ? (
        <div className="m-auto flex flex-col items-center gap-3 text-sm text-ink-2">
          {tr('Lyrics can’t be loaded right now.')}
          <button onClick={() => setRetry((n) => n + 1)} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
            <ArrowCounterClockwise size={13} /> {tr('Try again')}
          </button>
        </div>
      ) : !l ? (
        <p className="m-auto max-w-64 text-center text-sm text-ink-2">{signedIn ? tr('No lyrics found for this song (searched LRCLIB and YouTube Music).') : tr('No lyrics found for this song (searched LRCLIB).')}</p>
      ) : l.instrumental && !l.lines.length && !l.plain ? (
        <p className="m-auto text-lg font-semibold text-ink-2">♪ {tr('Instrumental')}</p>
      ) : l.lines.length ? (
        <>
          {tuning && (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-2.5 text-xs">
              <p className="text-ink-2">{tr('Click each line the moment you hear it start. Two lines far apart fix the speed too.')}</p>
              <div className="flex items-center gap-1.5">
                <RoundButton label={tr('Lyrics earlier')} size="sm" onClick={() => saveFix({ ...fix, offset: fix.offset - NUDGE_MS })}>
                  <CaretLeft size={13} />
                </RoundButton>
                <span className="min-w-20 text-center font-mono tabular-nums">
                  {fix.offset >= 0 ? '+' : '−'}
                  {(Math.abs(fix.offset) / 1000).toFixed(1)} s{fix.rate !== 1 && ` · ×${fix.rate.toFixed(2)}`}
                </span>
                <RoundButton label={tr('Lyrics later')} size="sm" onClick={() => saveFix({ ...fix, offset: fix.offset + NUDGE_MS })}>
                  <CaretRight size={13} />
                </RoundButton>
                <span className="flex-1" />
                <button
                  onClick={() => {
                    taps.current = []
                    saveFix(null)
                  }}
                  className="rounded-full px-2.5 py-1 font-medium text-ink-2 hover:bg-panel hover:text-ink"
                >
                  {tr('Reset')}
                </button>
                <button onClick={() => setTuning(false)} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg">
                  {tr('Done')}
                </button>
              </div>
            </div>
          )}
          <Synced lines={l.lines} durationMs={durationMs} fix={fix} onTap={tuning ? tap : undefined} />
        </>
      ) : (
        <Plain text={l.plain ?? ''} durationMs={durationMs} />
      )}
      {l && (
        <p className="flex items-center gap-2 px-1 text-[0.6875rem] text-ink-3">
          {tr('Lyrics: {source}', { source: l.source })}
          {!l.lines.length && l.plain && (
            <span title={tr('No timings for this song: the text follows the song roughly.')} className="rounded-full border border-line px-1.5 py-px">
              {tr('Not synced')}
            </span>
          )}
        </p>
      )}
    </aside>
  )
}
