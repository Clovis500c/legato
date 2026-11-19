/** The phone layout's bottom tabs, in order (PhoneTabs.tsx). Radio is here because the sidebar that holds it on a PC is hidden on a phone. */
export const PHONE_TABS = ['home', 'search', 'library', 'mixes', 'radio'] as const
export type PhoneTab = (typeof PHONE_TABS)[number]

/** The tabs shown: the sidebar entries hidden in Settings (`hiddenNav`) are hidden here too (the owner, 2026-11-19). Search
 * and Your library can't be hidden, so one is always left. */
export const phoneTabs = (hidden: readonly string[]): PhoneTab[] => PHONE_TABS.filter((t) => !hidden.includes(t))

/** Which tab is lit: the library's while its column is open wide, else the page's own (a mix is Mixes'); none for another page. */
export function activeTab(view: string, wide: boolean): PhoneTab | null {
  if (wide) return 'library'
  return view === 'home' || view === 'search' || view === 'radio' ? view : view === 'mixes' || view === 'mix' ? 'mixes' : null
}
