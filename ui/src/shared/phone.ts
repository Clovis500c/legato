import { useSyncExternalStore } from 'react'

/** Phone layout: narrower than 640 px, as the `phone:` variant (styles.css). Never a desktop window. */
export const PHONE = '(width < 640px)'
const query = typeof window === 'undefined' ? undefined : window.matchMedia(PHONE)
const listen = (on: () => void) => {
  query?.addEventListener('change', on)
  return () => query?.removeEventListener('change', on)
}
export const isPhone = () => !!query?.matches

/** For what CSS can't switch (a list for a grid, other controls): re-renders when the width crosses 640 px. */
export const usePhone = () => useSyncExternalStore(listen, isPhone)
