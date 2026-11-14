import { MAX_BACK, scrollKey } from './navHistory'
import type { View } from './store'

/**
 * Back and Forward put a page's scroll back where it was, as a browser does. The pages scroll in containers of their own (the main
 * pane is `overflow-hidden`): the one that matters is the biggest scrollable box in `main`. Remembered as a page is left, put back once
 * the page has laid out its content (a list that fills later than about a second is not waited for). No DOM at load: store.ts imports this.
 */
const saved = new Map<string, number>()

/** The biggest box in `main` that scrolls, or null. */
export function scroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let best: HTMLElement | null = null
  let area = 0
  for (const e of document.querySelectorAll<HTMLElement>('main *')) {
    if (e.scrollHeight <= e.clientHeight + 1) continue
    const o = getComputedStyle(e).overflowY
    if (o !== 'auto' && o !== 'scroll') continue
    if (e.clientHeight * e.clientWidth > area) {
      area = e.clientHeight * e.clientWidth
      best = e
    }
  }
  return best
}

/** Called as `view` is left. A page scrolled to the top forgets its entry. */
export function rememberScroll(view: View) {
  const top = scroller()?.scrollTop ?? 0
  const key = scrollKey(view)
  saved.delete(key)
  if (top > 0) saved.set(key, top)
  // Bounded like the history it serves.
  if (saved.size > MAX_BACK) saved.delete(saved.keys().next().value!)
}

/** Called as `view` is shown again by Back or Forward: scrolls once its content is tall enough (up to ~1 s of frames), else as far as it gets. */
export function restoreScroll(view: View) {
  const want = saved.get(scrollKey(view))
  if (!want || typeof requestAnimationFrame === 'undefined') return
  let frames = 0
  const tryIt = () => {
    const el = scroller()
    if (el && (el.scrollHeight - el.clientHeight >= want || frames >= 60)) return void (el.scrollTop = want)
    if (frames++ < 60) requestAnimationFrame(tryIt)
  }
  requestAnimationFrame(tryIt)
}
