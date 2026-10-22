/**
 * What plugins hand the interface, checked before use (pure: no app/settings here). A plugin's panel is data, never
 * markup: a small tree of known parts drawn by the app. Its CSS is text in a <style>, links taken out.
 */

export type PanelNode =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; muted: boolean }
  | { type: 'button'; id: string; label: string; primary: boolean }
  | { type: 'toggle'; id: string; label: string; value: boolean }
  | { type: 'slider'; id: string; label: string; value: number; min: number; max: number; step: number }
  | { type: 'input'; id: string; label: string; value: string }
  | { type: 'select'; id: string; label: string; value: string; options: { value: string; label: string }[] }
  | { type: 'tracks'; ids: number[] }
  | { type: 'row'; children: PanelNode[] }
  | { type: 'divider' }

export type Where = 'player' | 'track' | 'playlist'

export interface PluginCommand {
  id: string
  title: string
  where: Where[]
}

const MAX_NODES = 300
const MAX_DEPTH = 6
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const id = (v: unknown) => str(v, 64)

/** A plugin's panel: unknown parts dropped, sizes bounded. */
export function cleanTree(raw: unknown): PanelNode[] {
  let count = 0
  const walk = (list: unknown, depth: number): PanelNode[] => {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return []
    const out: PanelNode[] = []
    for (const n of list) {
      if (++count > MAX_NODES) break
      if (!n || typeof n !== 'object') continue
      const o = n as Record<string, unknown>
      switch (o.type) {
        case 'heading':
          out.push({ type: 'heading', text: str(o.text, 120) })
          break
        case 'text':
          out.push({ type: 'text', text: str(o.text, 2000), muted: o.muted === true })
          break
        case 'button':
          if (id(o.id)) out.push({ type: 'button', id: id(o.id), label: str(o.label, 60), primary: o.primary === true })
          break
        case 'toggle':
          if (id(o.id)) out.push({ type: 'toggle', id: id(o.id), label: str(o.label, 120), value: o.value === true })
          break
        case 'slider': {
          const min = num(o.min, 0)
          const max = Math.max(min, num(o.max, 100))
          if (id(o.id)) out.push({ type: 'slider', id: id(o.id), label: str(o.label, 120), min, max, step: Math.max(0, num(o.step, 1)), value: Math.min(max, Math.max(min, num(o.value, min))) })
          break
        }
        case 'input':
          if (id(o.id)) out.push({ type: 'input', id: id(o.id), label: str(o.label, 120), value: str(o.value, 500) })
          break
        case 'select': {
          const options = (Array.isArray(o.options) ? o.options : []).slice(0, 50).map((x) => ({ value: str((x as Record<string, unknown>)?.value, 100), label: str((x as Record<string, unknown>)?.label, 100) }))
          if (id(o.id) && options.length) out.push({ type: 'select', id: id(o.id), label: str(o.label, 120), value: str(o.value, 100), options })
          break
        }
        case 'tracks':
          out.push({ type: 'tracks', ids: (Array.isArray(o.ids) ? o.ids : []).filter((x): x is number => Number.isInteger(x)).slice(0, 200) })
          break
        case 'row':
          out.push({ type: 'row', children: walk(o.children, depth + 1) })
          break
        case 'divider':
          out.push({ type: 'divider' })
          break
      }
    }
    return out
  }
  return walk(raw, 0)
}

/** A plugin's menu item, or null. */
export function cleanCommand(raw: unknown): PluginCommand | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const where = (Array.isArray(o.where) ? o.where : ['player']).filter((w): w is Where => w === 'player' || w === 'track' || w === 'playlist')
  return id(o.id) && str(o.title, 60).trim() ? { id: id(o.id), title: str(o.title, 60).trim(), where: where.length ? where : ['player'] } : null
}

/** A plugin's CSS: see shared/css.ts. */
export { cleanCss } from '../../shared/css'
