/**
 * Keys while the visualizer is full screen, ahead of every other listener (capture on the window): Esc leaves. Every
 * other key stays the app's (play / pause, volume, seek). A menu open on top (or a field) keeps its own Esc. Returns cleanup.
 */
export function vizFullKeys(leave: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
    if (document.querySelector('[role="menu"]') || (typeof Element !== 'undefined' && e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]'))) return
    e.preventDefault()
    e.stopImmediatePropagation()
    leave()
  }
  window.addEventListener('keydown', onKey, { capture: true })
  return () => window.removeEventListener('keydown', onKey, { capture: true })
}
