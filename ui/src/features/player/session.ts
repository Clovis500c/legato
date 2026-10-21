import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import type { Repeat } from './queue'
import type { Via } from './sources'
import { usePlayer } from './store'

/** Saved playback: library queue as ids (dropped files are not kept). */
export interface Session {
  ids: number[]
  index: number
  order: number[]
  shuffle: boolean
  repeat: Repeat
  positionMs: number
  via?: Via
  volume: number
  /** Saved while paused: an update relaunch comes back paused. */
  paused?: boolean
}

const MAX_IDS = 10_000

/** What to save from the player, or null when nothing from the library plays. */
export function snapshot(p: { now?: { trackId?: number; via: Via }; list: LibraryTrack[]; index: number; order: number[]; shuffle: boolean; repeat: Repeat; positionMs: number; volume: number; playing?: boolean }): Session | null {
  if (!p.now?.trackId || !p.list.length) return null
  // Huge queues: keep a window around the current track.
  const from = Math.max(0, Math.min(p.index - MAX_IDS / 2, p.list.length - MAX_IDS))
  const list = p.list.slice(from, from + MAX_IDS)
  const order = from || list.length < p.list.length ? [] : p.order
  return { ids: list.map((t) => t.id), index: p.index - from, order, shuffle: p.shuffle, repeat: p.repeat, positionMs: Math.round(p.positionMs), via: p.now.via, volume: p.volume, paused: p.playing === false }
}

const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

/**
 * Stored session → queue on today's library. Tracks deleted since are dropped; the current one gone = nothing to
 * resume (volume still comes back).
 */
export function restore(raw: unknown, tracks: LibraryTrack[]): { volume: number; queue: { list: LibraryTrack[]; index: number; order: number[]; shuffle: boolean; repeat: Repeat; positionMs: number; via?: Via; paused: boolean } | null } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const volume = typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1 ? r.volume : 1
  const ids = Array.isArray(r.ids) ? r.ids.filter(isInt) : []
  const current = isInt(r.index) ? ids[r.index] : undefined
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const list = ids.flatMap((id) => byId.get(id) ?? [])
  const index = list.findIndex((t) => t.id === current)
  if (index < 0) return { volume, queue: null }
  // Same tracks as saved: saved shuffle order still fits, else rebuilt by the player.
  const order = list.length === ids.length && Array.isArray(r.order) && r.order.every(isInt) ? (r.order as number[]) : []
  const via = (['local', 'youtube', 'spotify', 'preview'] as const).find((v) => v === r.via)
  return {
    volume,
    queue: { list, index, order, shuffle: r.shuffle === true, repeat: r.repeat === 'all' || r.repeat === 'one' ? r.repeat : 'off', positionMs: isInt(r.positionMs) ? r.positionMs : 0, via, paused: r.paused === true },
  }
}

/**
 * Launch: volume back, and (enabled: Settings › Advanced) the last queue playing again where it stopped. exact = first
 * launch after an update: back as it was even if resume is off, paused if it was.
 */
export async function resumeSession(enabled: boolean, exact = false) {
  const saved = restore(await api.loadSession().catch(() => null), useStore.getState().tracks)
  if (!saved) return
  usePlayer.setState({ volume: saved.volume })
  if (!saved.queue || (!enabled && !exact) || usePlayer.getState().now) return
  usePlayer.getState().resume({ ...saved.queue, paused: exact && saved.queue.paused })
}

/** The next song, from its start, playing: an update installs between two songs and the app comes back on it. */
export async function saveSessionAtNext(index: number) {
  const p = usePlayer.getState()
  const s = snapshot({ ...p, index, positionMs: 0, playing: true })
  // Its own best source: the one that ended may not suit it.
  if (s) await api.saveSession({ ...s, via: undefined }).catch(() => {})
}

/** Right now (before an update closes the app). */
export async function saveSessionNow() {
  const s = snapshot(usePlayer.getState())
  if (s) await api.saveSession(s).catch(() => {})
}

/** Saves the session as playback goes: right away on track or state change, every 5 s while playing. Returns cleanup. */
export function startSessionSaving(): () => void {
  let at = 0
  const save = () => {
    const s = snapshot(usePlayer.getState())
    if (!s) return
    at = Date.now()
    void api.saveSession(s).catch(() => {})
  }
  const unsub = usePlayer.subscribe((s, prev) => {
    if (s.now !== prev.now || s.playing !== prev.playing || s.volume !== prev.volume || s.shuffle !== prev.shuffle || s.repeat !== prev.repeat || Math.abs(s.positionMs - prev.positionMs) > 3000) save()
    else if (s.positionMs !== prev.positionMs && Date.now() - at > 5000) save()
  })
  window.addEventListener('beforeunload', save)
  return () => {
    unsub()
    window.removeEventListener('beforeunload', save)
  }
}
