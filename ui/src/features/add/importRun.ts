import type { CSSProperties } from 'react'
import type { SpotifyLibraryImport, SpotifyProgress, SpotifySong } from '../../shared/api'
import { trn } from '../../shared/i18n/i18n'

/** A song on the import screen's deck; `seq` keeps its card across updates. */
export interface Seen extends SpotifySong {
  seq: number
}

/** The running Spotify import, as the app shows it (src-tauri spotify_web.rs, spotify_export.rs). */
export interface ImportRun {
  progress?: SpotifyProgress
  seen: Seen[]
  next: number
  /** Hidden: a toast counts instead, the app stays free. */
  hidden: boolean
  /** The end, for the screen to say. */
  result?: SpotifyLibraryImport
}

export const CARDS = 7
/** Screen updates at most this often, whatever the pace of songs: every card gets to move. */
export const BEAT = 120

export const newRun = (): ImportRun => ({ seen: [], next: 0, hidden: false })

export function advance(run: ImportRun, progress: SpotifyProgress): ImportRun {
  if (!progress.song) return { ...run, progress }
  return { ...run, progress, seen: [...run.seen, { ...progress.song, seq: run.next }].slice(-CARDS), next: run.next + 1 }
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

export const summary = (r: SpotifyLibraryImport) => trn(r.lists, 'Imported {n} list from Spotify: {found} of {songs} songs playable', 'Imported {n} lists from Spotify: {found} of {songs} songs playable', { found: r.playable, songs: r.songs })
