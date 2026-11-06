// What one Back press closes, top first (Android's Back on the phone). Pure: `androidBack.ts` reads the stores.
export interface BackState {
  /** A right-click menu or bottom sheet. */
  menu: boolean
  /** A dialog (`shared/ui/layers.ts`). */
  layer: boolean
  viz: boolean
  cover: boolean
  karaoke: boolean
  /** Now Playing full. */
  full: boolean
  /** A page to go back to. */
  canBack: boolean
}

export type BackStep = 'menu' | 'layer' | 'viz' | 'cover' | 'karaoke' | 'full' | 'page'

/** Null: nothing left, the app goes behind the others (as Home does). */
export function backStep(s: BackState): BackStep | null {
  if (s.menu) return 'menu'
  if (s.layer) return 'layer'
  if (s.viz) return 'viz'
  if (s.cover) return 'cover'
  if (s.karaoke) return 'karaoke'
  if (s.full) return 'full'
  if (s.canBack) return 'page'
  return null
}
