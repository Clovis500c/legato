import { usePlayer } from '../features/player/store'
import { useStore } from './store'

/** Keys as KeyboardEvent gives them; only what matching needs. */
export type Keys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export interface Shortcut {
  /** Shown in Settings › Shortcuts. */
  keys: string
  label: string
  match: (e: Keys) => boolean
  /** None = handled elsewhere (listed only). */
  run?: () => void
}

const ctrl = (e: Keys) => e.ctrlKey || e.metaKey
const plain = (e: Keys) => !ctrl(e) && !e.shiftKey && !e.altKey
const only = (e: Keys, mod: 'ctrl' | 'shift' | 'alt') => (mod === 'ctrl' ? ctrl(e) : !ctrl(e)) && e.shiftKey === (mod === 'shift') && e.altKey === (mod === 'alt')

const player = () => usePlayer.getState()
const seekBy = (ms: number) => {
  const { now, positionMs, durationMs, seek } = player()
  if (now) seek(Math.max(0, Math.min(positionMs + ms, durationMs ?? Infinity)))
}
const volumeBy = (d: number) => player().setVolume(Math.round(Math.max(0, Math.min(1, player().volume + d)) * 100) / 100)

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Space', label: 'Play / pause', match: (e) => plain(e) && e.key === ' ', run: () => player().toggle() },
  { keys: 'Ctrl →', label: 'Next track', match: (e) => only(e, 'ctrl') && e.key === 'ArrowRight', run: () => player().step(1) },
  { keys: 'Ctrl ←', label: 'Previous track', match: (e) => only(e, 'ctrl') && e.key === 'ArrowLeft', run: () => player().step(-1) },
  { keys: 'Shift →', label: 'Forward 10 seconds', match: (e) => only(e, 'shift') && e.key === 'ArrowRight', run: () => seekBy(10_000) },
  { keys: 'Shift ←', label: 'Back 10 seconds', match: (e) => only(e, 'shift') && e.key === 'ArrowLeft', run: () => seekBy(-10_000) },
  { keys: 'Ctrl ↑', label: 'Volume up', match: (e) => only(e, 'ctrl') && e.key === 'ArrowUp', run: () => volumeBy(0.1) },
  { keys: 'Ctrl ↓', label: 'Volume down', match: (e) => only(e, 'ctrl') && e.key === 'ArrowDown', run: () => volumeBy(-0.1) },
  { keys: 'Ctrl S', label: 'Shuffle on / off', match: (e) => only(e, 'ctrl') && e.key.toLowerCase() === 's', run: () => player().toggleShuffle() },
  { keys: 'Ctrl R', label: 'Repeat: off, queue, track', match: (e) => only(e, 'ctrl') && e.key.toLowerCase() === 'r', run: () => player().cycleRepeat() },
  { keys: 'Ctrl K', label: 'Search', match: () => false },
  { keys: 'Ctrl ,', label: 'Settings', match: (e) => only(e, 'ctrl') && e.key === ',', run: () => useStore.getState().go({ name: 'settings', section: 'appearance' }) },
  { keys: 'Alt ←', label: 'Back', match: (e) => only(e, 'alt') && e.key === 'ArrowLeft', run: () => (player().full ? player().setFull(false) : useStore.getState().goBack()) },
  { keys: 'Alt →', label: 'Forward', match: (e) => only(e, 'alt') && e.key === 'ArrowRight', run: () => useStore.getState().goForward() },
  { keys: 'Esc', label: 'Close Now Playing', match: () => false },
]

/** Shortcut for this key press, if any. */
export const shortcutFor = (e: Keys) => SHORTCUTS.find((s) => s.run && s.match(e))

// Fields where keys type text. Range inputs and checkboxes are not: they must not swallow the app's shortcuts.
const TEXT = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]):not([type=button]), textarea, select, [contenteditable]'
const inText = (target: EventTarget | null) => target instanceof Element && !!target.closest(TEXT)

/** Typing, or a control that uses this key itself (Space on a button, arrows on a slider). */
export function ownsKeys(target: EventTarget | null, key: string) {
  if (!(target instanceof Element)) return false
  if (target.closest(TEXT)) return true
  // Sliders keep their arrows; Space on them is play / pause.
  if (target.closest('input[type=range], [role="slider"]')) return key !== ' '
  return !!target.closest('button, a[href], [role="button"], [role="menuitem"]')
}

/** Global key handler. Returns cleanup. */
export function startShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat && e.key === ' ') return
    const s = shortcutFor(e)
    // Modifier shortcuts work everywhere but in text fields; plain keys leave focused controls alone.
    if (!s || (plain(e) ? ownsKeys(e.target, e.key) : inText(e.target))) return
    e.preventDefault()
    s.run!()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
