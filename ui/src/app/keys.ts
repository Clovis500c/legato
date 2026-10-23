import { msg, tr } from '../shared/i18n/i18n'
/**
 * Keyboard shortcuts: one table of actions with their default keys, user bindings over it, combos read from physical
 * keys (any keyboard layout). Pure: no store, no window (tests and the settings search import it).
 * In the app: `shortcuts.ts`. Everywhere (global, the app in the background or in the tray): Rust registers them.
 */

/** Modifiers in a fixed order, then the physical key (KeyboardEvent.code): "Ctrl+Alt+ArrowRight", "Space", "Ctrl+KeyS". */
export type Combo = string

export type ActionId =
  | 'playPause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'forward'
  | 'back10'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'nowPlaying'
  | 'search'
  | 'settings'
  | 'goBack'
  | 'goForward'
  | 'showApp'

export interface ActionInfo {
  id: ActionId
  label: string
  /** Default in the app (null = none). */
  keys: Combo | null
  /** Default everywhere, the app in the background included (null = none). */
  global: Combo | null
  /** Can't run in the app (only global makes sense). */
  globalOnly?: boolean
}

/**
 * Global defaults use Ctrl+Alt: rarely held by other apps. Media keys are never registered: the Windows media session
 * (media.rs) already takes them, a hotkey would steal them from every other player.
 */
export const ACTIONS: ActionInfo[] = [
  { id: 'playPause', label: msg('Play / pause'), keys: 'Space', global: 'Ctrl+Alt+Space' },
  { id: 'next', label: msg('Next track'), keys: 'Ctrl+ArrowRight', global: 'Ctrl+Alt+ArrowRight' },
  { id: 'previous', label: msg('Previous track'), keys: 'Ctrl+ArrowLeft', global: 'Ctrl+Alt+ArrowLeft' },
  { id: 'stop', label: msg('Stop'), keys: 'Ctrl+Shift+Space', global: null },
  { id: 'forward', label: msg('Forward 10 seconds'), keys: 'Shift+ArrowRight', global: null },
  { id: 'back10', label: msg('Back 10 seconds'), keys: 'Shift+ArrowLeft', global: null },
  { id: 'volumeUp', label: msg('Volume up'), keys: 'Ctrl+ArrowUp', global: 'Ctrl+Alt+ArrowUp' },
  { id: 'volumeDown', label: msg('Volume down'), keys: 'Ctrl+ArrowDown', global: 'Ctrl+Alt+ArrowDown' },
  { id: 'mute', label: msg('Mute / unmute'), keys: 'Ctrl+KeyM', global: null },
  { id: 'shuffle', label: msg('Shuffle on / off'), keys: 'Ctrl+KeyS', global: null },
  { id: 'repeat', label: msg('Repeat: off, queue, track'), keys: 'Ctrl+KeyR', global: null },
  { id: 'nowPlaying', label: msg('Open / close Now Playing'), keys: 'KeyF', global: null }, // F (user's choice 2026-10-23), was Ctrl+P.
  { id: 'search', label: msg('Search'), keys: 'Ctrl+KeyK', global: null },
  { id: 'settings', label: msg('Settings'), keys: 'Ctrl+Comma', global: null },
  { id: 'goBack', label: msg('Back'), keys: 'Alt+ArrowLeft', global: null },
  { id: 'goForward', label: msg('Forward'), keys: 'Alt+ArrowRight', global: null },
  { id: 'showApp', label: msg('Show Music App'), keys: null, global: 'Ctrl+Alt+KeyM', globalOnly: true },
]

/** What the user changed (settings `shortcuts`): null = removed, absent = default. */
export type Custom = Partial<Record<string, { keys?: Combo | null; global?: Combo | null }>>

export interface Binding {
  keys: Combo | null
  global: Combo | null
}

/** Effective bindings: user's over defaults. */
export function bindings(custom: Custom): Record<ActionId, Binding> {
  return Object.fromEntries(
    ACTIONS.map((a) => {
      const c = custom[a.id] ?? {}
      return [a.id, { keys: a.globalOnly ? null : c.keys !== undefined ? c.keys : a.keys, global: c.global !== undefined ? c.global : a.global }]
    }),
  ) as Record<ActionId, Binding>
}

/** Keys as KeyboardEvent gives them; only what a combo needs. */
export type Keys = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/
// Never bindable: the system and the media session own them.
const RESERVED = /^(Media|Audio|Volume|Launch|Browser|Power|Sleep|WakeUp)/

/** Combo of a key press. Null for a lone modifier or a key the system owns. */
export function comboOf(e: Keys): Combo | null {
  const code = e.code || e.key
  if (!code || MODIFIER_CODES.test(code) || RESERVED.test(code)) return null
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean)
  return [...mods, code].join('+')
}

/** Combo has a modifier (global ones need one: a bare key held system-wide would type nowhere else). */
export const hasModifier = (c: Combo) => /^(Ctrl|Alt|Shift|Meta)\+/.test(c)

const KEY_NAMES: Record<string, string> = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: msg('Space'), Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Escape: msg('Esc'), Enter: msg('Enter'), Backspace: msg('Backspace'), Tab: msg('Tab'), Shift: msg('Shift') }

/** "Ctrl+Alt+ArrowRight" → "Ctrl Alt →", "Ctrl+KeyS" → "Ctrl S". Key words in the interface's language (Maj, Espace…). */
export function comboLabel(c: Combo): string {
  return c
    .split('+')
    .map((p) => (KEY_NAMES[p] ? tr(KEY_NAMES[p]) : p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')))
    .join(' ')
}

/** Accelerator for the OS hotkey (Rust global-shortcut): same names, Meta = Super. */
export const accelerator = (c: Combo) => c.replace(/\bMeta\b/, 'Super')

/** Actions sharing a combo with another, per kind (in the app, everywhere). */
export function conflicts(b: Record<ActionId, Binding>): Set<string> {
  const out = new Set<string>()
  for (const kind of ['keys', 'global'] as const) {
    const seen = new Map<Combo, ActionId>()
    for (const a of ACTIONS) {
      const c = b[a.id][kind]
      if (!c) continue
      const other = seen.get(c)
      if (other) out.add(`${kind}:${a.id}`).add(`${kind}:${other}`)
      else seen.set(c, a.id)
    }
  }
  return out
}

/** Trust boundary (saved settings): combos the parser above could have made. */
export const validCombo = (c: unknown): c is Combo => typeof c === 'string' && /^((Ctrl|Alt|Shift|Meta)\+){0,4}[A-Za-z][A-Za-z0-9]{0,24}$/.test(c)
