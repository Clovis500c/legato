import { useStore } from '../../app/store'
import { usePlayer } from '../player/store'
import { openOsk } from './osk'
import { padActions, pressed, type PadAction } from './pad'
import { nextBox, type Dir } from './spatial'

const FOCUSABLE = 'button:not([disabled]), a[href], [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="search"], input[type="text"], input:not([type]), [data-list], [tabindex="0"]'
const KEYS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
/** Fields and controls that keep their own arrows (typing, sliders, open menus). */
const OWN = 'input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable], input[type=range], [role="slider"], [role="menu"], [role="listbox"]'

const visible = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
}

/** Moves the focus to the next control in that direction among the visible ones (inside the open dialog, if any). */
export function moveFocus(dir: Dir): boolean {
  const scope = document.querySelector('[role="dialog"]') ?? document
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
  if (!all.length) return false
  const at = all.findIndex((e) => e === document.activeElement)
  // Nothing focused yet: the first control, whatever the arrow.
  if (at < 0) return (all[0].focus(), true)
  const boxes = all.map((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const to = nextBox(boxes, at, dir)
  if (to === null) return false
  all[to].focus()
  all[to].scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return true
}

/** Esc / the pad's B: closes nothing that is open (dialogs and menus handle it), else goes back. */
function back() {
  if (document.querySelector('[role="dialog"], [role="menu"]')) return
  const p = usePlayer.getState()
  if (p.full) p.setFull(false)
  else useStore.getState().goBack()
}

const act = (a: PadAction) => {
  const t = document.activeElement
  if (a === 'back') back()
  else if (a === 'press') (t instanceof HTMLElement && t !== document.body ? t : null)?.click()
  else moveFocus(a)
}

/**
 * Living-room mode (Settings › General): the arrows move between controls, Enter presses the focused one (a button does by
 * itself), Esc goes back. The interface is also drawn larger and the focus ring heavier (`app/settings.ts`, index.css).
 * Returns cleanup.
 */
export function startLivingRoom(on: () => boolean, subscribe: (f: () => void) => () => void): () => void {
  const apply = () => document.documentElement.classList.toggle('living-room', on())
  apply()
  const off = subscribe(apply)
  const key = (e: KeyboardEvent) => {
    if (!on() || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
    const t = e.target instanceof Element ? e.target : null
    // Enter in a text field opens the on-screen keyboard (its own Enter key sends one too: not a real key press).
    if (e.key === 'Enter' && e.isTrusted && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.matches('input:not([type]), input[type=text], input[type=search], textarea') && !t.readOnly) {
      openOsk(t)
      e.preventDefault()
      return
    }
    if (t?.closest(OWN)) return
    const dir = KEYS[e.key]
    if (dir) {
      if (moveFocus(dir)) e.preventDefault()
      return
    }
    if (e.key === 'Enter' && t && t !== document.body && !t.matches('button, a, input, textarea, select, summary')) {
      ;(t as HTMLElement).click()
      e.preventDefault()
      return
    }
    // Esc closes what is open first (dialogs and menus handle it themselves); on a page it goes back.
    if (e.key === 'Escape') back()
  }
  addEventListener('keydown', key)
  // A gamepad (Gamepad API, standard layout): the d-pad or left stick moves, A presses, B goes back. Polled while the mode is on.
  let prev: boolean[] = []
  let frame = 0
  const poll = () => {
    if (on()) {
      const pad = [...(navigator.getGamepads?.() ?? [])].find((g) => g?.connected)
      const now = pad ? pressed(pad.buttons, pad.axes) : []
      padActions(prev, now).forEach(act)
      prev = now
    }
    frame = requestAnimationFrame(poll)
  }
  frame = requestAnimationFrame(poll)
  return () => {
    cancelAnimationFrame(frame)
    off()
    removeEventListener('keydown', key)
    document.documentElement.classList.remove('living-room')
  }
}
