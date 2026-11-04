import { useSyncExternalStore } from 'react'

/** A media query read in render: its state, and who to tell when it changes. */
function media(q: string) {
  const query = typeof window === 'undefined' ? undefined : window.matchMedia(q)
  return {
    get: () => !!query?.matches,
    listen: (on: () => void) => {
      query?.addEventListener('change', on)
      return () => query?.removeEventListener('change', on)
    },
  }
}

/** Phone layout: narrower than 640 px, as the `phone:` variant (styles.css). Never a desktop window. */
export const PHONE = '(width < 640px)'
const phone = media(PHONE)
export const isPhone = phone.get

/** For what CSS can't switch (a list for a grid, other controls): re-renders when the width crosses 640 px. */
export const usePhone = () => useSyncExternalStore(phone.listen, phone.get)

/**
 * Narrow window, not a phone (640 to 1200 px: the smallest window, a small laptop, a big interface size): the right panel
 * steps aside so the page keeps its room (SidePanel: beside it the page had 200 to 600 px), its mini player floats.
 */
const narrow = media('(640px <= width < 1200px)')
export const useNarrow = () => useSyncExternalStore(narrow.listen, narrow.get)
