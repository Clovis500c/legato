/** Where the visitor's choice from the header's language menu is kept (this browser only). */
export const SAVED = 'legato.lang'

/**
 * The page a visitor of the English root wants: their saved choice, or else their browser's languages (the device's,
 * most wanted first), a code among `codes`; 'en' when English comes first or nothing fits. Traditional Chinese (zh-TW,
 * zh-HK, zh-Hant) isn't sent to the Simplified page. Self-contained, no outside names: `Shell` writes it into the root
 * page as a script that runs before the first paint.
 */
export function pick(saved: string | null, wanted: readonly string[], codes: readonly string[]): string {
  if (saved) return codes.indexOf(saved) >= 0 ? saved : 'en'
  for (let i = 0; i < wanted.length; i++) {
    const tag = String(wanted[i]).toLowerCase()
    const base = tag.split('-')[0]
    if (base === 'en') return 'en'
    if (base === 'zh' && /-(hant|tw|hk|mo)(-|$)/.test(tag)) continue
    if (codes.indexOf(base) >= 0) return base
  }
  return 'en'
}
