/**
 * Bar ballistics of the visualizer (vizScene.ts), pure: levels rise fast and fall slower, a peak cap holds 0.5 s
 * then falls with gravity (speeds up like a dropped weight). Heights are 0..1 of the box. In place on typed arrays:
 * one step per drawn frame, no garbage.
 */
export interface Ballistics {
  /** Time constants of the level, s: toward a higher / lower target. */
  attack: number
  release: number
  /** Peak cap stays this long after a new high, s. */
  hold: number
  /** Then falls with this acceleration, box heights per s². */
  gravity: number
}

export const NORMAL: Ballistics = { attack: 0.03, release: 0.18, hold: 0.5, gravity: 1.8 }
/** Reduced motion: slower in both directions, the cap sinks gently. */
export const CALM: Ballistics = { attack: 0.12, release: 0.5, hold: 0.8, gravity: 0.4 }

export interface Bars {
  level: Float32Array
  peak: Float32Array
  /** Hold time left, s. */
  held: Float32Array
  /** Fall speed of the cap, box heights per s. */
  fall: Float32Array
}

export const newBars = (n: number): Bars => ({ level: new Float32Array(n), peak: new Float32Array(n), held: new Float32Array(n), fall: new Float32Array(n) })

/** A band's dB → height 0..1: -78 dB (nothing) to -10 (full). A band reads 0 dB for a full-scale sine alone in it. */
export const FLOOR_DB = -78
export const TOP_DB = -10
export const levelOf = (db: number) => Math.min(1, Math.max(0, (db - FLOOR_DB) / (TOP_DB - FLOOR_DB)))

/** One step of `dt` seconds toward `target` (heights 0..1; undefined = rest). */
export function stepBars(b: Bars, target: ArrayLike<number> | undefined, dt: number, bal: Ballistics): void {
  const up = 1 - Math.exp(-dt / bal.attack)
  const down = 1 - Math.exp(-dt / bal.release)
  for (let i = 0; i < b.level.length; i++) {
    const to = target ? (target[i] ?? 0) : 0
    const level = b.level[i] + (to - b.level[i]) * (to > b.level[i] ? up : down)
    b.level[i] = level
    if (level >= b.peak[i]) {
      b.peak[i] = level
      b.held[i] = bal.hold
      b.fall[i] = 0
    } else if (b.held[i] > 0) {
      b.held[i] -= dt
    } else {
      b.fall[i] += bal.gravity * dt
      b.peak[i] = Math.max(level, b.peak[i] - b.fall[i] * dt)
      if (b.peak[i] === level) b.fall[i] = 0
    }
  }
}

/** Nothing moves nor shows: the loop may stop. */
export const atRest = (b: Bars) => b.level.every((v) => v < 0.002) && b.peak.every((v) => v < 0.002)

/** Segments lit for a level, of `segs`. */
export const litSegments = (level: number, segs: number) => Math.min(segs, Math.max(0, Math.round(level * segs)))

/** The cap's segment, 1-based from the bottom (0 = none), never under the lit ones; a peak under half a segment shows none. */
export const capSegment = (peak: number, lit: number, segs: number) => Math.max(lit, Math.min(segs, Math.round(peak * segs)))
