import type { Effects } from '../../shared/api'
import { msg } from '../../shared/i18n/i18n'

/**
 * Live Editor settings (crates/dsp effects.rs): neutral values, built-in presets, the key edits are saved under.
 * Pure: no app/settings here.
 */
export const NEUTRAL: Effects = {
  on: true,
  speed: 1,
  tempo: 1,
  pitch: 0,
  bass: 0,
  eq: [0, 0, 0, 0, 0],
  reverb: { mix: 0, size: 0.7, damping: 0.4, predelayMs: 20 },
  echo: { mix: 0, timeMs: 300, feedback: 0.3 },
  space: { on: false, azimuth: 0, elevation: 0, distance: 1, rotate: false, periodS: 8, room: 0.2 },
  compress: 0,
  width: 1,
  balance: 0,
}

/** Equalizer bands, Hz (effects.rs EQ_FREQS). */
export const EQ_FREQS = [60, 250, 1000, 4000, 12000] as const

/** Timeline speed and pitch ratio (effects.rs `rates`). */
/** Time and pitch rates, ×0.25 to ×4 each (what the stretcher takes: effects.rs `rates`, live.js). */
const fitRate = (r: number) => Math.min(4, Math.max(0.25, r))
export const rates = (e: Effects): [number, number] => (e.on ? [fitRate(e.speed * e.tempo), fitRate(e.speed * 2 ** (e.pitch / 12))] : [1, 1])

/** Changes nothing (or bypassed). */
export function neutral(e: Effects): boolean {
  if (!e.on) return true
  const [t, p] = rates(e)
  return t === 1 && p === 1 && e.bass === 0 && e.eq.every((g) => g === 0) && e.reverb.mix === 0 && e.echo.mix === 0 && !e.space.on && e.compress === 0 && e.width === 1 && e.balance === 0
}

/** Missing or wrong fields → neutral ones (saved edits from older versions, hand-edited JSON). */
export function cleanEffects(raw: unknown): Effects {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  const sub = (k: string) => (o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, number | boolean>) : {})
  const r = sub('reverb')
  const c = sub('echo')
  const s = sub('space')
  const eq = Array.isArray(o.eq) ? o.eq : []
  return {
    on: o.on !== false,
    speed: n(o.speed, 0.25, 2.5, 1),
    tempo: n(o.tempo, 0.25, 2.5, 1),
    pitch: n(o.pitch, -24, 24, 0),
    bass: n(o.bass, 0, 24, 0),
    eq: [0, 1, 2, 3, 4].map((i) => n(eq[i], -24, 24, 0)) as Effects['eq'],
    reverb: { mix: n(r.mix, 0, 1, 0), size: n(r.size, 0, 1, 0.7), damping: n(r.damping, 0, 1, 0.4), predelayMs: n(r.predelayMs, 0, 250, 20) },
    echo: { mix: n(c.mix, 0, 1, 0), timeMs: n(c.timeMs, 20, 2000, 300), feedback: n(c.feedback, 0, 0.95, 0.3) },
    space: { on: s.on === true, azimuth: n(s.azimuth, -180, 180, 0), elevation: n(s.elevation, -90, 90, 0), distance: n(s.distance, 0.25, 10, 1), rotate: s.rotate === true, periodS: n(s.periodS, 1, 60, 8), room: n(s.room, 0, 1, 0.2) },
    compress: n(o.compress, 0, 1, 0),
    width: n(o.width, 0, 3, 1),
    balance: n(o.balance, -1, 1, 0),
  }
}

/** Ready-made edits: one click, then tune. */
export const PRESETS: { name: string; effects: Effects }[] = [
  { name: msg('Slowed'), effects: { ...NEUTRAL, speed: 0.85 } },
  { name: msg('Slowed + reverb'), effects: { ...NEUTRAL, speed: 0.8, reverb: { mix: 0.35, size: 0.85, damping: 0.5, predelayMs: 30 } } },
  { name: msg('Nightcore'), effects: { ...NEUTRAL, speed: 1.25 } },
  { name: msg('Sped up'), effects: { ...NEUTRAL, speed: 1.15 } },
  { name: msg('8D'), effects: { ...NEUTRAL, space: { on: true, azimuth: 0, elevation: 0, distance: 1.2, rotate: true, periodS: 8, room: 0.3 } } },
  { name: msg('Bass boost'), effects: { ...NEUTRAL, bass: 8, eq: [3, 0, 0, 0, 0] } },
  { name: msg('Concert hall'), effects: { ...NEUTRAL, reverb: { mix: 0.45, size: 0.95, damping: 0.3, predelayMs: 40 }, width: 1.3 } },
]

/** Key a song's edits are saved under: library track, else its video, else its file. Recommendations (negative ids) aren't in the library: their video. */
export function songKey(now: { trackId?: number; youtubeId?: string; path?: string } | null | undefined): string | null {
  if (!now) return null
  if (now.trackId !== undefined && now.trackId > 0) return `t:${now.trackId}`
  if (now.youtubeId) return `yt:${now.youtubeId}`
  if (now.path) return `f:${now.path}`
  return null
}
