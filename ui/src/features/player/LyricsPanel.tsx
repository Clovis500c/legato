import { ArrowCounterClockwise, CaretLeft, CaretRight, MicrophoneStage, MusicNotesSimple, PencilSimple, Queue, Timer } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Lyrics } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { RoundButton } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { songKey } from './effects'
import { applyFix, fixesWith, fixFromTaps, fixLabel, lineAt, lineEnd, NO_FIX, toLrc, withBreaks, wordTimes, type LyricsFix, type TimedWord } from './lyricsAt'
import { toggleKaraoke } from './karaokeMode'
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
 * The line being sung, filled word by word as the song goes (karaoke), glowing as Settings › Appearance › Glow says; at the source's own word times
 * when it has them (`timed`), else spread over the line. One animation per word on the
 * compositor's clock (smooth every frame); position reports only correct it when it's really off, never every tick
 * (that made it shake).
 */
export function Sung({ text, start, end, timed }: { text: string; start: number; end: number; timed?: TimedWord[] | null }) {
  const pos = usePosition(250)
  const playing = usePlayer((s) => s.playing)
  const box = useRef<HTMLSpanElement>(null)
  const anims = useRef<Animation[]>([])
  const words = useMemo(() => wordTimes(text, start, end, timed), [text, start, end, timed])
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
    <span ref={box} className="glow-sung">
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
            <Sung text={l.text} start={l.ms} end={lineEnd(lines, i, durationMs)} timed={l.words} />
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

/** Lyrics of what plays (lrclib, cached by the app): asked once per song, again once its length is known (slowed
 * versions need it to fit the timings). mine.lyrics undefined = still looking. */
export function useNowLyrics() {
  const now = usePlayer((s) => s.now)
  const playerMs = usePlayer((s) => s.durationMs)
  const track = useNowTrack()
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
      .lyrics({ title, artist, album: track?.album ?? null, durationMs, youtube: now?.youtubeId ?? track?.ids.youtube ?? null, trackId: now?.via === 'local' && track ? track.id : null })
      .then((lyrics) => live && setGot({ for: key, lyrics }))
      .catch((e) => live && setGot({ for: key, error: String(e) }))
    return () => {
      live = false
    }
  }, [key, ready, retry]) // once per song (and per retry)
  const mine = got?.for === key ? got : undefined
  return { mine, key, durationMs, retry: () => setRetry((n) => n + 1) }
}

/** Plain lyrics timed by tapping Now as each line starts, the song playing (a local song): saved into its file as LRC. */
function TapTimer({ text, onSave, onClose }: { text: string; onSave: (lrc: string) => Promise<boolean>; onClose: () => void }) {
  const lines = useMemo(() => text.split('\n').map((t) => t.trim()).filter(Boolean), [text])
  const [taps, setTaps] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const n = taps.length
  // Never before the line above: a slip can't reorder them.
  const tap = () => setTaps((t) => (t.length < lines.length ? [...t, Math.max(t[t.length - 1] ?? 0, Math.round(positionNow()) - REACTION_MS)] : t))
  const save = async () => {
    setBusy(true)
    if (!(await onSave(toLrc(lines.map((line, i) => ({ ms: taps[i], text: line })))))) setBusy(false)
  }
  const quiet = 'rounded-full px-2.5 py-1 font-medium text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 py-4">
      <p className="text-xs text-ink-2">{tr('Play the song from its start and tap Now as each line begins.')}</p>
      <p className="text-[0.6875rem] text-ink-3 tabular-nums">{tr('Line {n} of {total}', { n: Math.min(n + 1, lines.length), total: lines.length })}</p>
      <p className="text-[1.25rem] leading-snug font-semibold">{lines[n] ?? '♪'}</p>
      <p className="text-sm text-ink-2">{lines[n + 1] ?? ''}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
        <button onClick={tap} disabled={n >= lines.length} className="rounded-full bg-ink px-4 py-1.5 font-semibold text-bg disabled:opacity-40">
          {tr('Now')}
        </button>
        <button onClick={() => setTaps((t) => t.slice(0, -1))} disabled={!n} className={quiet}>
          {tr('Back')}
        </button>
        <span className="flex-1" />
        <button onClick={onClose} className={quiet}>
          {tr('Cancel')}
        </button>
        <button onClick={() => void save()} disabled={busy || n < lines.length} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg disabled:opacity-40">
          {tr('Save into the file')}
        </button>
      </div>
    </div>
  )
}

/** A local song's lyrics, edited as text and saved into its file: lines starting with a stamp keep their timing. */
function LyricsEditor({ text: first, onSave, onClose }: { text: string; onSave: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState(first)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    if (await onSave(text)) onClose()
    else setBusy(false)
  }
  return (
    <Dialog title={tr('Edit lyrics')} wide onClose={onClose}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={16}
        maxLength={80_000}
        className="min-h-60 resize-y rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-ink-3"
      />
      <p className="text-[0.6875rem] text-ink-3">
        {tr('A line starting with a time like [01:02.50] is synced to it.')} {tr('Written into the file: other players see it too. The sound stays as it is.')}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
        <Button data-default disabled={busy || !text.trim()} onClick={() => void save()}>
          {tr('Save')}
        </Button>
      </div>
    </Dialog>
  )
}

/**
 * Now Playing › Lyrics, beside the cover (Spotify-like). LRCLIB first (synced when it can be, stretched for slowed /
 * sped up versions), YouTube Music's own when signed in (src-tauri lyrics), cached on disk. heading = what heads the
 * panel instead of "Lyrics" (the main window's tabs, which also reach Up next).
 */
export function LyricsPanel({ onHide, onUpNext, className = CARD, heading }: { onHide: () => void; onUpNext: () => void; className?: string; heading?: ReactNode }) {
  const now = usePlayer((s) => s.now)
  const signedIn = useStore((s) => s.status.youtube.connected)
  const { mine, key, durationMs, retry } = useNowLyrics()
  // Its local file playing: lyrics edited and saved into it. The song is kept with the editor: it may end meanwhile.
  const track = useNowTrack()
  const fileId = now?.via === 'local' && track ? track.id : null
  const [editing, setEditing] = useState<{ id: number; song: string | null; text: string } | null>(null)
  // Plain lyrics being timed by tapping along: this song only.
  const [timing, setTiming] = useState<{ id: number; song: string | null } | null>(null)

  // Timing fixed by hand for this song (Settings, synced with the other PCs).
  const song = songKey(now)
  const fix = useSettings((s) => (song && s.settings.lyricsSync[song]) || NO_FIX)
  const [tuning, setTuning] = useState(false)
  const taps = useRef<{ lyric: number; song: number }[]>([])
  useEffect(() => {
    setTuning(false)
    setTiming(null)
    taps.current = []
  }, [key])
  const saveFix = (f: LyricsFix | null, of = song) => {
    if (of) useSettings.getState().update({ lyricsSync: fixesWith(useSettings.getState().settings.lyricsSync, of, f) })
  }
  // What shows, as text: LRC with the fixed timing when synced.
  const shown = (l: Lyrics) => (l.lines.length ? toLrc(applyFix(l.lines, fix)) : (l.plain ?? ''))
  const intoFile = async (id: number, of: string | null, text: string) => {
    try {
      await api.writeLyrics(id, text)
      // The timing is the file's now.
      if (of && useSettings.getState().settings.lyricsSync[of]) saveFix(null, of)
      useStore.getState().notify(tr('Saved in the file'), { kind: 'ok' })
      retry()
      return true
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
      return false
    }
  }
  const tap = (lyric: number) => {
    taps.current = [...taps.current, { lyric, song: positionNow() - REACTION_MS }]
    saveFix(fixFromTaps(taps.current, fix))
  }

  const l = mine?.lyrics
  return (
    <aside aria-label={tr('Lyrics')} className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 px-1">
        <span className="flex min-w-0 flex-1 items-center text-[0.8125rem] font-semibold">{heading ?? tr('Lyrics')}</span>
        {fileId !== null && l && (
          <RoundButton label={tr('Edit lyrics')} kind="plain" size="sm" onClick={() => setEditing({ id: fileId, song, text: shown(l) })}>
            <PencilSimple size={14} />
          </RoundButton>
        )}
        {fileId !== null && l && !l.lines.length && !!l.plain && (
          <RoundButton
            label={tr('Time them by tapping along')}
            kind="plain"
            size="sm"
            aria-pressed={!!timing}
            className={timing ? 'bg-ink! text-bg!' : ''}
            onClick={() => setTiming(timing ? null : { id: fileId, song })}
          >
            <Timer size={14} />
          </RoundButton>
        )}
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
        <RoundButton label={tr('Karaoke')} kind="plain" size="sm" onClick={toggleKaraoke}>
          <MicrophoneStage size={14} />
        </RoundButton>
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
          <button onClick={retry} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
            <ArrowCounterClockwise size={13} /> {tr('Try again')}
          </button>
        </div>
      ) : !l ? (
        <div className="m-auto flex max-w-64 flex-col items-center gap-3 text-center text-sm text-ink-2">
          {signedIn ? tr('No lyrics found for this song (searched LRCLIB and YouTube Music).') : tr('No lyrics found for this song (searched LRCLIB).')}
          {fileId !== null && (
            <button onClick={() => setEditing({ id: fileId, song, text: '' })} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
              <PencilSimple size={13} /> {tr('Add lyrics')}
            </button>
          )}
        </div>
      ) : l.instrumental && !l.lines.length && !l.plain ? (
        <p className="m-auto text-lg font-semibold text-ink-2">♪ {tr('Instrumental')}</p>
      ) : l.lines.length ? (
        <>
          {tuning && (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-2.5 text-xs">
              <p className="text-ink-2">{tr('Click each line the moment you hear it start. Two lines far apart fix the speed too.')}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <RoundButton label={tr('Lyrics earlier')} size="sm" onClick={() => saveFix({ ...fix, offset: fix.offset - NUDGE_MS })}>
                  <CaretLeft size={13} />
                </RoundButton>
                <span className="min-w-20 text-center font-mono tabular-nums">
                  {fixLabel(fix)}
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
                {fileId !== null && (fix.offset !== 0 || fix.rate !== 1) && (
                  <button onClick={() => void intoFile(fileId, song, shown(l)).then((ok) => ok && setTuning(false))} className="rounded-full px-2.5 py-1 font-medium text-ink-2 hover:bg-panel hover:text-ink">
                    {tr('Save into the file')}
                  </button>
                )}
                <button onClick={() => setTuning(false)} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg">
                  {tr('Done')}
                </button>
              </div>
            </div>
          )}
          <Synced lines={l.lines} durationMs={durationMs} fix={fix} onTap={tuning ? tap : undefined} />
        </>
      ) : timing ? (
        <TapTimer text={l.plain ?? ''} onSave={(lrc) => intoFile(timing.id, timing.song, lrc).then((ok) => (ok && setTiming(null), ok))} onClose={() => setTiming(null)} />
      ) : (
        <Plain text={l.plain ?? ''} durationMs={durationMs} />
      )}
      {l && (
        <p className="flex items-center gap-2 px-1 text-[0.6875rem] text-ink-3">
          {l.own ? tr('Lyrics from the song’s own file') : tr('Lyrics: {source}', { source: l.source })}
          {!l.lines.length && l.plain && (
            <span title={tr('No timings for this song: the text follows the song roughly.')} className="rounded-full border border-line px-1.5 py-px">
              {tr('Not synced')}
            </span>
          )}
        </p>
      )}
      {editing && createPortal(<LyricsEditor text={editing.text} onSave={(text) => intoFile(editing.id, editing.song, text)} onClose={() => setEditing(null)} />, document.body)}
    </aside>
  )
}
