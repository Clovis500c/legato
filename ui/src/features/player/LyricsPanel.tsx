import { ArrowCounterClockwise, CaretRight, MusicNotesSimple, Queue } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Lyrics } from '../../shared/api'
import { RoundButton } from '../../shared/ui/controls'
import { lineAt, lineEnd, withBreaks, wordFill } from './lyricsAt'
import { usePosition } from './Progress'
import { useNowTrack, usePlayer } from './store'
import { tr } from '../../shared/i18n/i18n'

/** Lines light up this much early: a line shows as it's sung, not after. */
const LEAD_MS = 200
/** A hand on the scroll wins for this long. */
const HAND_MS = 4000

/** The line being sung, filled word by word as the song goes (karaoke), softly glowing. Re-renders ~25 times a second. */
function Sung({ text, start, end }: { text: string; start: number; end: number }) {
  const pos = usePosition(40)
  return (
    <span className="drop-shadow-[0_0_14px_color-mix(in_srgb,var(--ink)_30%,transparent)]">
      {wordFill(text, start, end, pos + LEAD_MS).map((w, i) => (
        <span key={i} className="bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(90deg, var(--ink) ${w.fill * 100}%, var(--ink-3) ${w.fill * 100}%)` }}>
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
function Synced({ lines: sung, durationMs }: { lines: Lyrics['lines']; durationMs: number | null }) {
  const lines = useMemo(() => withBreaks(sung, durationMs), [sung, durationMs])
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
    <div ref={box} onWheel={touched} onPointerDown={touched} onKeyDown={touched} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-6">
      {lines.map((l, i) => (
        <button
          key={i}
          data-line={i}
          onClick={() => seek(l.ms)}
          className={`block w-full origin-left py-1.5 text-left text-[26px] leading-snug font-bold tracking-[-0.01em] transition-[color,transform,opacity] duration-300 ${i === at ? 'scale-[1.03] text-ink' : i < at ? 'text-ink-2 opacity-70 hover:opacity-100' : 'text-ink-3 hover:text-ink-2'}`}
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
 * Now Playing › Lyrics, beside the cover (Spotify-like). LRCLIB first (synced when it can be, stretched for slowed /
 * sped up versions), YouTube Music's own when signed in (src-tauri lyrics), cached on disk.
 */
export function LyricsPanel({ onHide, onUpNext }: { onHide: () => void; onUpNext: () => void }) {
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
  const key = `${artist}|${title}`
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

  const mine = got?.for === key ? got : undefined
  const l = mine?.lyrics
  return (
    <aside aria-label={tr('Lyrics')} className="flex min-h-0 flex-col gap-2 rounded-2xl border border-line-soft bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] p-3">
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-[13px] font-semibold">{tr('Lyrics')}</span>
        <RoundButton label={tr('Show Up next instead')} kind="plain" size="sm" onClick={onUpNext}>
          <Queue size={14} />
        </RoundButton>
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
        <Synced lines={l.lines} durationMs={durationMs} />
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 py-4">
          <p className="text-[20px] leading-relaxed font-semibold whitespace-pre-line text-ink">{l.plain}</p>
        </div>
      )}
      {l && <p className="px-1 text-[11px] text-ink-3">{tr('Lyrics: {source}', { source: l.source })}</p>}
    </aside>
  )
}
