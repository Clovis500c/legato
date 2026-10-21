import type { FadeCurve, Settings } from '../../shared/theme/theme'
import { msg } from '../../shared/i18n/i18n'

/** Fade the player applies: seconds each way, shapes, skip and pause fades. */
export interface Fade {
  out: number
  in: number
  outCurve: FadeCurve
  inCurve: FadeCurve
  skip: boolean
  /** ms */
  pause: number
}

export const NO_FADE: Fade = { out: 0, in: 0, outCurve: 'scurve', inCurve: 'scurve', skip: false, pause: 0 }

/** Settings → fade. Simple mode: same seconds out and in, S-curve, nothing else. */
export function effectiveFade(s: Pick<Settings, 'crossfade' | 'fade'>): Fade {
  if (!s.fade.advanced) return { ...NO_FADE, out: s.crossfade, in: s.crossfade }
  const { out, in: fin, outCurve, inCurve, skip, pause } = s.fade
  return { out, in: fin, outCurve, inCurve, skip, pause }
}

export const curveLabels: Record<FadeCurve, string> = { scurve: msg('S-curve'), linear: msg('Linear'), equal: msg('Equal power'), exp: msg('Exponential'), log: msg('Logarithmic') }
export const curveHints: Record<FadeCurve, string> = {
  scurve: msg('Gentle at both ends'),
  linear: msg('Straight line'),
  equal: msg('Keeps loudness up, no dip'),
  exp: msg('Sounds even to the ear, long soft tail'),
  log: msg('Quick change, then settles'),
}

/**
 * Rising volume 0 → 1 over x in 0..1. A fade out plays it backwards (x = time left), so Exponential drops fast and
 * keeps a long quiet tail, the way sound engineers fade out.
 */
export function shape(curve: FadeCurve, x: number): number {
  const c = Math.min(1, Math.max(0, x))
  switch (curve) {
    case 'linear':
      return c
    case 'equal':
      return Math.sin((c * Math.PI) / 2)
    case 'exp':
      return c ** 3
    case 'log':
      return 1 - (1 - c) ** 3
    default:
      return c * c * (3 - 2 * c)
  }
}

/**
 * Volume factor for fades between songs. fadeIn = track started on its own after the previous one (or a skip, if
 * asked). Tracks shorter than both fades never fade out.
 */
export function fadeGain(positionMs: number, durationMs: number | null, f: Fade, fadeIn: boolean): number {
  const up = fadeIn && f.in > 0 ? shape(f.inCurve, positionMs / (f.in * 1000)) : 1
  const span = f.out * 1000
  const down = span > 0 && durationMs && durationMs > span + Math.max(span, f.in * 1000) ? shape(f.outCurve, (durationMs - positionMs) / span) : 1
  return Math.min(up, down)
}

/** Silence between songs in the preview: about what the next song takes to start. */
export const DEMO_GAP = 0.6

/** Preview of a song change, t seconds in: fade out, short gap, fade in. Length = demoLength. */
export function demoGain(t: number, f: Fade): number {
  if (t < f.out) return shape(f.outCurve, 1 - t / f.out)
  const after = t - f.out - DEMO_GAP
  if (after < 0) return 0
  return f.in > 0 ? shape(f.inCurve, after / f.in) : 1
}

export const demoLength = (f: Fade) => f.out + DEMO_GAP + f.in

/** SVG path of a fade from x0 to x1, y down: rising 0 → full, or falling full → 0 (fade out). */
export function curvePath(curve: FadeCurve, x0: number, x1: number, yZero: number, yFull: number, steps = 32, falling = false): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const g = shape(curve, falling ? 1 - t : t)
    pts.push(`${(x0 + (x1 - x0) * t).toFixed(1)},${(yZero + (yFull - yZero) * g).toFixed(1)}`)
  }
  return `M${pts.join('L')}`
}
