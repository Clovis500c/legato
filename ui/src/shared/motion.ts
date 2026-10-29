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
