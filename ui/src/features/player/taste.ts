import { create } from 'zustand'
import { api, type TasteSignal } from '../../shared/api'
import { onListenEnd } from './listens'

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
