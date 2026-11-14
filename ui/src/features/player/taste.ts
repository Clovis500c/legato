import { create } from 'zustand'
import { api, type LibraryTrack, type TasteSignal } from '../../shared/api'
import { onListenEnd } from './listens'
import type { Taste } from './score'

/**
 * The taste signals of the library (decayed plays, last played, recent skips, liked, less, never), read once from Rust and kept in memory
 * (docs/recommendation.md): Shuffle and what plays after Up next read this cache, never wait on it. A song not in it has no signal. Loaded
 * when the app is idle and again every `RELOAD_EVERY` listens; a failed load keeps the previous one.
 */
export const RELOAD_EVERY = 20

interface TasteState {
  signals: Map<number, TasteSignal>
  loaded: boolean
}

export const useTaste = create<TasteState>(() => ({ signals: new Map(), loaded: false }))

export async function loadTaste(ask: () => Promise<TasteSignal[]> = api.tasteSignals): Promise<void> {
  try {
    useTaste.setState({ signals: new Map((await ask()).map((s) => [s.id, s])), loaded: true })
  } catch {
    // Offline from Rust never happens; a failed read leaves what we had.
  }
}

/** Loads now and after every `RELOAD_EVERY`-th listen. Returns the way out. */
export function startTaste(ask: () => Promise<TasteSignal[]> = api.tasteSignals): () => void {
  void loadTaste(ask)
  let n = 0
  return onListenEnd(() => {
    if (++n % RELOAD_EVERY === 0) void loadTaste(ask)
  })
}

/** What the model reads about a song: the store's stats (`stats[id]` = listens, last start, rating) and the signals. */
export function tasteFor(stats: Record<number, [plays: number, last: number, stars?: number] | undefined>, signals: Map<number, TasteSignal>): Taste {
  return {
    rating: (t: LibraryTrack) => stats[t.id]?.[2] ?? 0,
    plays: (t: LibraryTrack) => stats[t.id]?.[0] ?? 0,
    skips: (t: LibraryTrack) => signals.get(t.id)?.skipsRecent ?? 0,
    never: (t: LibraryTrack) => signals.get(t.id)?.never ?? false,
    less: (t: LibraryTrack) => signals.get(t.id)?.less ?? false,
    liked: (t: LibraryTrack) => signals.get(t.id)?.liked ?? false,
    decayed: (t: LibraryTrack) => signals.get(t.id)?.playsLong ?? 0,
    lastPlayed: (t: LibraryTrack) => signals.get(t.id)?.lastPlayed ?? 0,
  }
}
