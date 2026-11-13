import { refreshOutputs, useOutputs } from './outputs'
import { usePlayer } from './store'

/** The volume last set on each output device (its name; the system's default is `default`), this PC's. */
export type Memory = Record<string, number>

const STORE = 'legato.volumeByDevice'
/** Devices remembered at most: a long-gone headset is not worth a slot. */
const KEEP = 50

/** Mute is not a volume to come back to. */
export const remember = (m: Memory, key: string, volume: number): Memory => {
  if (volume <= 0.02) return m
  // Moved to the end: the least recently used goes first.
  return Object.fromEntries([...Object.entries(m).filter(([k]) => k !== key), [key, Math.round(volume * 100) / 100]].slice(-KEEP))
}

/**
 * What a change does: the device changed (a volume to bring back, or this one's first sight: it takes the volume it
 * arrives at), or the volume changed (kept for the device it is on).
 */
export function step(m: Memory, key: string, prevKey: string, volume: number, prevVolume: number): { memory: Memory; set?: number } {
  if (key !== prevKey) {
    const had = m[key]
    if (had === undefined) return { memory: remember(m, key, volume) }
    // Muted (volume 0): it stays muted, the device's volume comes back with the unmute.
    return had !== volume && volume > 0 ? { memory: m, set: had } : { memory: m }
  }
  return volume !== prevVolume ? { memory: remember(m, key, volume) } : { memory: m }
}

function load(): Memory {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}
function save(m: Memory) {
  try {
    localStorage.setItem(STORE, JSON.stringify(m))
  } catch {
    // Private window or full: the volumes are not kept, nothing else is lost.
  }
}

/**
 * Settings › Playback › Volume per output device (`enabled`, off by default): the volume set while a device is in use is
 * kept for it and comes back when that device is picked in the player's menu. Only a pick made here is seen (Windows'
 * own default changing is not). Returns cleanup.
 */
export function startVolumePerDevice(enabled: () => boolean): () => void {
  let memory = load()
  let key = useOutputs.getState().current ?? 'default'
  let volume = usePlayer.getState().volume
  let applying = false
  let asked = false
  const run = () => {
    // The picked device is only known once asked: when the setting first shows on.
    if (enabled() && !asked) {
      asked = true
      refreshOutputs()
    }
    const nextKey = useOutputs.getState().current ?? 'default'
    const nextVolume = usePlayer.getState().volume
    if (enabled() && !applying) {
      const r = step(memory, nextKey, key, nextVolume, volume)
      // The player store changes on every position tick: written only when a volume moved.
      if (r.memory !== memory) save((memory = r.memory))
      if (r.set !== undefined) {
        applying = true
        usePlayer.getState().setVolume(r.set)
        applying = false
      }
    }
    key = nextKey
    volume = usePlayer.getState().volume
  }
  run()
  const offs = [usePlayer.subscribe(run), useOutputs.subscribe(run)]
  return () => offs.forEach((f) => f())
}
