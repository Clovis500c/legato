import { create } from 'zustand'
import { usePlayer } from '../features/player/store'
import { toggleKaraoke } from '../features/player/karaokeMode'
import { nudgeVolume } from '../features/player/volume'
import { api } from '../shared/api'
import { accelerator, ACTIONS, bindings, comboOf, type ActionId, type Combo } from './keys'
import { useSettings } from './settings'
import { useStore } from './store'
import { toggleFullscreen } from './fullscreen'

const player = () => usePlayer.getState()
const seekBy = (ms: number) => {
  const { now, positionMs, durationMs, seek } = player()
  if (now) seek(Math.max(0, Math.min(positionMs + ms, durationMs ?? Infinity)))
}

/** What each action does. One table with keys.ts (labels, default keys): Settings › Shortcuts lists both. */
export const RUN: Record<ActionId, () => void> = {
  playPause: () => player().toggle(),
  next: () => player().step(1),
  previous: () => player().step(-1),
  stop: () => {
    if (player().playing) player().toggle()
    player().seek(0)
  },
  forward: () => seekBy(10_000),
  back10: () => seekBy(-10_000),
  volumeUp: () => nudgeVolume(0.1),
  volumeDown: () => nudgeVolume(-0.1),
  mute: () => player().toggleMute(),
  shuffle: () => player().toggleShuffle(),
  repeat: () => player().cycleRepeat(),
  nowPlaying: () => player().now && player().setFull(!player().full),
  fullscreen: () => void toggleFullscreen(),
  karaoke: toggleKaraoke,
  search: () => document.querySelector<HTMLInputElement>('[data-search]')?.focus(),
  settings: () => useStore.getState().go({ name: 'settings', section: 'shortcuts' }),
  goBack: () => (player().full ? player().setFull(false) : useStore.getState().goBack()),
  goForward: () => useStore.getState().goForward(),
  // Rust shows the window itself (global only).
  showApp: () => {},
}

// Fields where keys type text. Range inputs and checkboxes are not: they must not swallow the app's shortcuts.
const TEXT = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]):not([type=button]), textarea, select, [contenteditable]'
const inText = (target: EventTarget | null) => target instanceof Element && !!target.closest(TEXT)
// Sliders keep their arrows (no modifier); menus keep theirs.
const ownsArrows = (target: EventTarget | null) => target instanceof Element && !!target.closest('input[type=range], [role="slider"], [role="menu"], [role="menuitem"]')

/**
 * Space presses a control reached by keyboard (:focus-visible), or anything in a dialog. Track lists ([data-list])
 * leave it to play / pause.
 */
const ownsSpace = (target: EventTarget | null) => target instanceof HTMLElement && target !== document.body && !target.matches('[data-list]') && (target.matches(':focus-visible') || !!target.closest('[role="dialog"]'))

/** Global shortcuts the OS refused (another app holds them), for Settings › Shortcuts. */
export const useGlobalShortcuts = create<{ failed: ActionId[] }>(() => ({ failed: [] }))

/** Registers the global bindings with the OS (Rust). Called at launch and whenever they change. */
async function registerGlobals(custom: Parameters<typeof bindings>[0]) {
  const b = bindings(custom)
  const list = ACTIONS.flatMap((a) => (b[a.id].global ? [{ id: a.id, accelerator: accelerator(b[a.id].global!) }] : []))
  const failed = await api.setGlobalShortcuts(list).catch(() => list.map((l) => l.id))
  useGlobalShortcuts.setState({ failed: failed as ActionId[] })
}

/**
 * Keys in the app (window focused) and everywhere (global, Rust). Bindings come from settings over the defaults.
 * Text fields keep their keys; Space plays / pauses unless a control reached by keyboard has focus (a button left
 * focused by a mouse click doesn't count: Space still plays / pauses there).
 * Returns cleanup.
 */
export function startShortcuts(): () => void {
  let map = new Map<Combo, ActionId>()
  let custom = useSettings.getState().settings.shortcuts
  const rebuild = () => {
    const b = bindings(custom)
    map = new Map(ACTIONS.flatMap((a) => (b[a.id].keys ? [[b[a.id].keys!, a.id] as const] : [])))
  }
  rebuild()
  void registerGlobals(custom)
  const offSettings = useSettings.subscribe((s) => {
    if (s.settings.shortcuts === custom) return
    custom = s.settings.shortcuts
    rebuild()
    void registerGlobals(custom)
  })
  const onKey = (e: KeyboardEvent) => {
    // Settings › Shortcuts is recording a binding.
    if (document.body.dataset.recording) return
    const combo = comboOf(e)
    const id = combo && map.get(combo)
    if (!id || inText(e.target)) return
    if (e.repeat && (id === 'playPause' || id === 'karaoke')) return
    if (/^(Shift\+)?Arrow/.test(combo) && ownsArrows(e.target)) return
    if (combo === 'Space' && ownsSpace(e.target)) return
    e.preventDefault()
    RUN[id]()
  }
  window.addEventListener('keydown', onKey)
  // Mouse side buttons: back / forward, like a browser.
  const onMouse = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    RUN[e.button === 3 ? 'goBack' : 'goForward']()
  }
  window.addEventListener('mouseup', onMouse)
  // Pressed anywhere (global): Rust sends the action.
  const offGlobal = api.onShortcut((id) => RUN[id as ActionId]?.())
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mouseup', onMouse)
    offSettings()
    void offGlobal.then((f) => f())
  }
}
