import type { View } from './store'

/** The pure side of the in-app history Android's Back walks (store.ts `go` / `goBack`, screen.ts, androidBack.ts). */

/** Pages kept to go back to. */
export const MAX_BACK = 50

/** Same page: the same view, ignoring a settings search's highlight (`focus`) and the Spotify wizard. */
export function sameView(a: View, b: View): boolean {
  return scrollKey(a) === scrollKey(b)
}

/** What a page is called in the scroll memory and in `sameView`: the view without its transient parts. */
export function scrollKey(v: View): string {
  if (v.name === 'settings') return `settings:${v.section}`
  return JSON.stringify(v)
}

/** The stack after going from `current` to `next`: unchanged when it is the same page (a tab tapped twice), else `current` on top, the last `MAX_BACK` kept. */
export function pushView(back: View[], current: View, next: View): View[] {
  return sameView(current, next) ? back : [...back, current].slice(-MAX_BACK)
}
