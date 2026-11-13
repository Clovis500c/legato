import { usePlayer } from './store'
import type { Via } from './sources'

/** The volume last set on each source, this PC's (not synced: it follows this PC's speakers). */
export type Memory = Partial<Record<Via, number>>

const STORE = 'legato.volumeBySource'

/** Mute is not a volume to come back to. */
export const remember = (m: Memory, via: Via, volume: number): Memory => (volume > 0.02 ? { ...m, [via]: Math.round(volume * 100) / 100 } : m)

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
 * Settings › Playback › Volume per source (`enabled`, off by default): the volume set while a source plays is kept for that
 * source, and comes back when a song from it starts after one from another. A source not heard yet takes the volume it
 * arrives at. Returns cleanup.
 */
export function startVolumePerSource(enabled: () => boolean): () => void {
  let memory = load()
  let applying = false
  return usePlayer.subscribe((s, prev) => {
    const via = s.now?.via
    if (!enabled() || applying || !via) return
    if (via !== prev.now?.via) {
      const had = memory[via]
      if (had === undefined) memory = remember(memory, via, s.volume)
      // Muted (volume 0): it stays muted, the source's volume comes back with the unmute.
      else if (had !== s.volume && s.volume > 0) {
        applying = true
        s.setVolume(had)
        applying = false
      }
    } else if (s.volume !== prev.volume) memory = remember(memory, via, s.volume)
    else return
    save(memory)
  })
}
