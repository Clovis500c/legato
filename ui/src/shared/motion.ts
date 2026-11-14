import { useEffect, useState } from 'react'

/** Settings › Animations off (`.still` on the root, settings.ts) or Windows' animation effects off. */
const still = () => document.documentElement.classList.contains('still') || matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A quick pop on the icon just clicked (like, toggles). Web Animations: played on demand, never at mount or while a list
 * scrolls; `.still`'s CSS rule can't reach it, hence the check.
 */
export function pop(button: Element) {
  const icon = button.querySelector('svg')
  if (!icon || still()) return
  icon.animate([{ scale: 1 }, { scale: 1.3 }, { scale: 1 }], { duration: 300, easing: 'cubic-bezier(0.3, 0.9, 0.4, 1.2)' })
}

/** Moving background art may move only when Settings › Animations allows it AND the system does not ask for reduced motion (WCAG 2.2.2, `prefers-reduced-motion`). */
export const allowsMotion = (setting: boolean, systemReduced: boolean) => setting && !systemReduced

/** The system's "reduce motion" now, following its changes. */
export function useSystemReduced(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}
