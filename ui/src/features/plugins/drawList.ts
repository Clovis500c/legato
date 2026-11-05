/**
 * A plugin's visualizer picture (docs/plugins.md › Visualizer shapes): shapes as data, checked here, drawn by the app
 * (vizPaint.ts). Positions are shares of the box (0..1, x right, y down), a circle's radius a share of its shorter side,
 * widths and text sizes CSS px. Unknown shapes and bad values are dropped; MAX_OPS shapes and MAX_POINTS points at most.
 */
export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; color: string; alpha: number }
  | { op: 'line' | 'shape'; points: number[]; width: number; color: string; alpha: number }
  | { op: 'circle'; x: number; y: number; r: number; width: number; color: string; alpha: number }
  | { op: 'text'; x: number; y: number; text: string; size: number; color: string; alpha: number; align: 'left' | 'center' | 'right' }

export const MAX_OPS = 1000
export const MAX_POINTS = 8000

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)
/** 'warn' (the visualizer's alarm red), #rgb, #rrggbb or #rrggbbaa; anything else is 'ink', the visualizer's colour. */
const colorOf = (v: unknown) => (v === 'warn' || (typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) ? v : 'ink')
const ALIGNS = ['left', 'center', 'right'] as const

export function cleanOps(list: unknown): DrawOp[] {
  if (!Array.isArray(list)) return []
  const out: DrawOp[] = []
  let points = 0
  for (const o of list.slice(0, MAX_OPS)) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const color = colorOf(r.color)
    const alpha = num(r.alpha, 0, 1, 1)
    const x = num(r.x, -1, 2, 0)
    const y = num(r.y, -1, 2, 0)
    const op = r.op
    if (op === 'rect') out.push({ op, x, y, w: num(r.w, -2, 2, 0), h: num(r.h, -2, 2, 0), color, alpha })
    else if (op === 'circle') out.push({ op, x, y, r: num(r.r, 0, 2, 0), width: num(r.width, 0, 40, 0), color, alpha })
    else if (op === 'text' && typeof r.text === 'string' && r.text) {
      const align = ALIGNS.find((a) => a === r.align) ?? 'left'
      out.push({ op, x, y, text: r.text.slice(0, 100), size: num(r.size, 6, 120, 14), color, alpha, align })
    } else if ((op === 'line' || op === 'shape') && Array.isArray(r.points)) {
      const pts = r.points.slice(0, 2 * Math.max(0, MAX_POINTS - points)).map((v) => num(v, -1, 2, 0))
      if (pts.length % 2) pts.pop()
      if (pts.length < 4) continue
      points += pts.length / 2
      out.push({ op, points: pts, width: num(r.width, 0.5, 40, 1.5), color, alpha })
    }
  }
  return out
}

/** A plugin's look's name: its own few words, or the plugin's name. */
export const cleanLookName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : fallback)
