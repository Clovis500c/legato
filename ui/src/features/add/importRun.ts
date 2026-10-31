import type { CSSProperties } from 'react'
import type { SpotifyLibraryImport, SpotifyProgress, SpotifySong } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'

/** A song on the import screen's deck; `seq` keeps its card across updates. */
export interface Seen extends SpotifySong {
  seq: number
}

/** When a search count was reached. */
interface Mark {
  at: number
  searched: number
}

/** The running Spotify import, as the app shows it (src-tauri spotify_web.rs, spotify_export.rs). */
export interface ImportRun {
  progress?: SpotifyProgress
  /** The last moments' searches: the pace changes with what YouTube allows. */
  marks: Mark[]
  /** When YouTube lets the searches go on. Unset: it isn't holding them. */
  resumeAt?: number
  seen: Seen[]
  next: number
  /** Hidden: a toast counts instead, the app stays free. */
  hidden: boolean
  /** What runs: Spotify's or Apple Music's lists, the songs not found searched again (no list involved), a list shared with Legato, or an app's library file. */
  kind: ImportKind
  /** The end, for the screen to say. */
  result?: SpotifyLibraryImport
}

export type ImportKind = 'spotify' | 'apple' | 'again' | 'shared' | 'file'

export const CARDS = 7
/** Screen updates at most this often, whatever the pace of songs: every card gets to move. */
export const BEAT = 120

/** The pace is read over this long. */
const PACE_SPAN = 90_000
/** Below this, no number worth saying. */
const FEWEST_SEARCHES = 6
const SHORTEST_SPAN = 4_000

export const newRun = (kind: ImportKind = 'spotify'): ImportRun => ({ marks: [], seen: [], next: 0, hidden: false, kind })

function marked(run: ImportRun, { searched, toSearch }: SpotifyProgress, at: number): Mark[] {
  if (!toSearch || searched === run.marks.at(-1)?.searched) return run.marks
  // A slow import keeps enough to say: that's when the number counts.
  const kept = run.marks.filter((m, n) => at - m.at <= PACE_SPAN || n >= run.marks.length - FEWEST_SEARCHES)
  return [...kept, { at, searched }]
}

export function advance(run: ImportRun, progress: SpotifyProgress, now = Date.now()): ImportRun {
  const marks = marked(run, progress, now)
  const resumeAt = progress.waitSecs ? now + progress.waitSecs * 1000 : undefined
  if (!progress.song) return { ...run, progress, marks, resumeAt }
  return { ...run, progress, marks, resumeAt, seen: [...run.seen, { ...progress.song, seq: run.next }].slice(-CARDS), next: run.next + 1 }
}

/** Seconds left at the recent pace, counted up to now: what YouTube holds back slows it, the wait under way adds to it. */
export function secondsLeft({ progress: p, marks, resumeAt }: ImportRun, now: number): number | undefined {
  const [first, last] = [marks[0], marks.at(-1)]
  if (!p?.toSearch || !first || !last) return undefined
  const [searched, span] = [last.searched - first.searched, now - first.at]
  if (searched < FEWEST_SEARCHES || span < SHORTEST_SPAN) return undefined
  return ((p.toSearch - p.searched) * span) / searched / 1000 + Math.max((resumeAt ?? now) - now, 0) / 1000
}

/** Seconds of YouTube's wait left. 0: trying again. Undefined: no wait. */
export const waitLeft = ({ resumeAt }: ImportRun, now: number) => (resumeAt === undefined ? undefined : Math.max(Math.ceil((resumeAt - now) / 1000), 0))

export function timeLeft(seconds: number) {
  if (seconds < 60) return tr('Less than a minute left')
  return seconds < 3600 ? tr('About {n} min left', { n: Math.ceil(seconds / 60) }) : tr('About {n} h left', { n: Math.ceil(seconds / 3600) })
}

/** How far, 0 to 1. Spotify's page gives no total: each list counts the same. */
export function share(p: SpotifyProgress | undefined): number {
  if (!p) return 0
  if (p.allTotal) return Math.min(p.allDone / p.allTotal, 1)
  const part = p.total ? Math.min(p.done / p.total, 1) : 0
  return Math.min((p.list - 1 + part) / Math.max(p.lists, 1), 1)
}

/** Its place on the deck: newest on top, the last ones fanned out behind it, each staying on its side. Not playable: faded. */
export function card(seen: Seen, newest: number): CSSProperties {
  const back = newest - seen.seq
  const side = seen.seq % 2 ? 1 : -1
  return {
    transform: `translateX(${side * back * 48}px) rotate(${side * back * 5}deg) scale(${1 - back * 0.07})`,
    opacity: (1 - back * 0.14) * (seen.playable ? 1 : 0.45),
    zIndex: CARDS - back,
  }
}

export function summary(r: SpotifyLibraryImport) {
  const said = !r.lists ? tr('{found} of {songs} songs found on YouTube', { found: r.playable, songs: r.songs }) : trn(r.lists, 'Imported {n} list from Spotify: {found} of {songs} songs playable', 'Imported {n} lists from Spotify: {found} of {songs} songs playable', { found: r.playable, songs: r.songs })
  return r.unsearched ? `${said}. ${trn(r.unsearched, 'YouTube limited the searches: import again later for the {n} song left', 'YouTube limited the searches: import again later for the {n} songs left')}` : said
}
