import { nudgeOf } from './karaokeLines'

/**
 * Keys while karaoke is open, ahead of every other listener (capture on the window): Esc leaves, the bare arrows move
 * the lyrics. With Ctrl / Shift / Alt they stay the app's (volume, seek, back). A menu open on top (or a field) keeps its own Esc and arrows.
 * Returns cleanup.
 */
export function karaokeKeys(leave: () => void, nudge: (ms: number) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
    const ms = nudgeOf(e.code)
    // A menu open on top, or a field: its own Esc and arrows.
    if (document.querySelector('[role="menu"]') || (typeof Element !== 'undefined' && e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]'))) return
    if (e.code !== 'Escape' && ms === null) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.code === 'Escape') leave()
    else if (ms !== null) nudge(ms)
  }
  window.addEventListener('keydown', onKey, { capture: true })
  return () => window.removeEventListener('keydown', onKey, { capture: true })
}
