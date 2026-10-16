/** Hi-Fi themes: palettes, user settings schema, contrast check. Applied as CSS variables (styles.css @theme). */

export const PALETTE_KEYS = ['bg', 'panel', 'raised', 'recess', 'line', 'lineSoft', 'ink', 'ink2', 'ink3', 'ink4', 'accent', 'onAccent', 'ledOff'] as const
export type PaletteKey = (typeof PALETTE_KEYS)[number]
export type Palette = Record<PaletteKey, string>

export interface Theme extends Palette {
  id: string
  name: string
  dark: boolean
  font: 'hifi' | 'neutral'
  glow: boolean
}

const preset = (id: string, name: string, dark: boolean, p: Palette): Theme => ({ id, name, dark, font: 'hifi', glow: true, ...p })

// ink3 values tuned for WCAG AA (4.5:1) on bg.
export const PRESETS: Theme[] = [
  preset('papier', 'Papier', false, { bg: '#F3F1EC', panel: '#EAE7E0', raised: '#FBFAF7', recess: '#E1DDD4', line: '#D6D1C6', lineSoft: '#E4E0D7', ink: '#171614', ink2: '#5C5852', ink3: '#6B665E', ink4: '#B2ACA1', accent: '#FF5A1F', onAccent: '#FFFFFF', ledOff: '#CDC7BB' }),
  preset('graphite', 'Graphite', true, { bg: '#121211', panel: '#1A1A18', raised: '#24231F', recess: '#0B0B0A', line: '#302F2B', lineSoft: '#252421', ink: '#EDEAE4', ink2: '#A6A198', ink3: '#8A847B', ink4: '#55524C', accent: '#FF6A2E', onAccent: '#171614', ledOff: '#3A3935' }),
  preset('studio', 'Studio', true, { bg: '#000000', panel: '#0A0A0A', raised: '#161616', recess: '#000000', line: '#262626', lineSoft: '#1A1A1A', ink: '#FFFFFF', ink2: '#A3A3A3', ink3: '#7A7A7A', ink4: '#4D4D4D', accent: '#FF3B30', onAccent: '#FFFFFF', ledOff: '#333333' }),
  preset('aluminium', 'Aluminium', false, { bg: '#ECEEF0', panel: '#E1E4E8', raised: '#F7F8F9', recess: '#D7DBE0', line: '#C9CED5', lineSoft: '#DADEE3', ink: '#14171A', ink2: '#4E5660', ink3: '#5D656F', ink4: '#A4ACB5', accent: '#2F6FEB', onAccent: '#FFFFFF', ledOff: '#BFC5CC' }),
  preset('bakelite', 'Bakélite', true, { bg: '#1C1410', panel: '#241A14', raised: '#2E221A', recess: '#140E0B', line: '#3D2E24', lineSoft: '#2E231B', ink: '#F2E6D3', ink2: '#BFAE95', ink3: '#9E8E77', ink4: '#5E5244', accent: '#F2A900', onAccent: '#1C1410', ledOff: '#4A3B2F' }),
  preset('sauge', 'Sauge', false, { bg: '#E7ECE6', panel: '#DCE3DA', raised: '#F4F7F3', recess: '#D1D9CF', line: '#C2CCBF', lineSoft: '#D5DDD2', ink: '#152019', ink2: '#4C5B50', ink3: '#5B6A5E', ink4: '#A0ADA2', accent: '#1F7A4D', onAccent: '#FFFFFF', ledOff: '#B8C3B6' }),
]

export const ACCENTS = ['#FF5A1F', '#E5383B', '#F2B705', '#2E8B57', '#2F6FEB', '#171614']

export const COLUMNS = ['album', 'sources', 'duration'] as const
export type Column = (typeof COLUMNS)[number]

export interface Settings {
  /** Preset id, custom theme id, or 'system' (Papier / Graphite). */
  theme: string
  /** Overrides theme accent. */
  accent: string | null
  customThemes: Theme[]
  covers: 'net' | 'rounded' | 'vinyl'
  density: 'compact' | 'comfort' | 'airy'
  /** Webview zoom, percent. */
  zoom: number
  readout: boolean
  volume: 'knob' | 'bar'
  tuner: boolean
  columns: Column[]
}

export const DEFAULTS: Settings = {
  theme: 'papier',
  accent: null,
  customThemes: [],
  covers: 'net',
  density: 'comfort',
  zoom: 100,
  readout: true,
  volume: 'knob',
  tuner: true,
  columns: [...COLUMNS],
}

const HEX = /^#[0-9a-f]{6}$/i
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)

/** Trust boundary (file import, stored JSON): full palette or nothing. */
export function sanitizeTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!PALETTE_KEYS.every((k) => isHex(r[k]))) return null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Mon thème'
  const id = typeof r.id === 'string' && /^custom-[\w-]{1,40}$/.test(r.id) ? r.id : `custom-${Date.now().toString(36)}`
  const palette = Object.fromEntries(PALETTE_KEYS.map((k) => [k, (r[k] as string).toUpperCase()])) as Palette
  return { id, name, dark: luminance(palette.bg) < 0.2, font: pick(r.font, ['hifi', 'neutral'] as const, 'hifi'), glow: r.glow !== false, ...palette }
}

export function sanitize(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const customThemes = (Array.isArray(r.customThemes) ? r.customThemes : []).slice(0, 24).map(sanitizeTheme).filter((t): t is Theme => !!t)
  const ids = ['system', ...PRESETS.map((t) => t.id), ...customThemes.map((t) => t.id)]
  const columns = Array.isArray(r.columns) ? [...new Set(r.columns.filter((c): c is Column => COLUMNS.includes(c as Column)))] : DEFAULTS.columns
  return {
    theme: pick(r.theme, ids, DEFAULTS.theme),
    accent: isHex(r.accent) ? r.accent.toUpperCase() : null,
    customThemes,
    covers: pick(r.covers, ['net', 'rounded', 'vinyl'] as const, DEFAULTS.covers),
    density: pick(r.density, ['compact', 'comfort', 'airy'] as const, DEFAULTS.density),
    zoom: typeof r.zoom === 'number' && Number.isFinite(r.zoom) ? Math.min(125, Math.max(90, Math.round(r.zoom / 5) * 5)) : DEFAULTS.zoom,
    readout: typeof r.readout === 'boolean' ? r.readout : DEFAULTS.readout,
    volume: pick(r.volume, ['knob', 'bar'] as const, DEFAULTS.volume),
    tuner: typeof r.tuner === 'boolean' ? r.tuner : DEFAULTS.tuner,
    columns,
  }
}

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Pairs checked live in theme editor. AA: 4.5 for text, 3 for icons (accent only carries icons). */
export function contrastReport(t: Palette) {
  return [
    { label: 'Texte principal', ratio: contrast(t.ink, t.bg), min: 4.5 },
    { label: 'Texte secondaire', ratio: contrast(t.ink2, t.bg), min: 4.5 },
    { label: 'Texte discret', ratio: contrast(t.ink3, t.bg), min: 4.5 },
    { label: 'Texte sur panneau', ratio: contrast(t.ink2, t.panel), min: 4.5 },
    { label: 'Icône sur accent', ratio: contrast(t.onAccent, t.accent), min: 3 },
  ].map((c) => ({ ...c, ok: c.ratio >= c.min }))
}

export function resolveTheme(s: Settings, systemDark: boolean): Theme {
  const id = s.theme === 'system' ? (systemDark ? 'graphite' : 'papier') : s.theme
  const t = [...PRESETS, ...s.customThemes].find((x) => x.id === id) ?? PRESETS[0]
  return s.accent ? { ...t, accent: s.accent, onAccent: contrast('#FFFFFF', s.accent) >= 3 ? '#FFFFFF' : '#171614' } : t
}

const kebab = (k: string) => k.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)

/** Theme + layout settings → CSS custom properties (consumed by styles.css). */
export function cssVars(t: Theme, s: Settings): Record<string, string> {
  return {
    ...Object.fromEntries(PALETTE_KEYS.map((k) => [`--${kebab(k)}`, t[k]])),
    '--accent-soft': `${t.accent}1F`,
    '--shadow': t.dark ? '#00000099' : '#17161424',
    '--led-glow': t.glow ? `0 0 6px ${t.accent}AA` : 'none',
    '--font-ui': t.font === 'hifi' ? "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, sans-serif" : "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    '--cover-radius': { net: '3px', rounded: '10px', vinyl: '999px' }[s.covers],
    '--row-h': { compact: '40px', comfort: '52px', airy: '64px' }[s.density],
    'color-scheme': t.dark ? 'dark' : 'light',
  }
}
