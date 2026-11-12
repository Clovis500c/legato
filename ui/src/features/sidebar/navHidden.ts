import { msg } from '../../shared/i18n/i18n'
import { NAV_ITEMS, type NavItem } from '../../shared/theme/theme'

/** The sidebar entries that can be hidden (Settings and the way back are never among them), as the words they carry. */
export const NAV_LABEL: Record<NavItem, string> = { home: msg('Home'), mixes: msg('Mixes'), radio: msg('Radio'), stats: msg('Stats'), add: msg('Add music') }

/** The sidebar entry a page belongs to (a mix belongs to Mixes), or none. */
export const navOf = (page: string): NavItem | null => (page === 'mix' ? 'mixes' : (NAV_ITEMS as readonly string[]).includes(page) ? (page as NavItem) : null)

/** `hidden` with `id` hidden or shown again (once each, in the order of the entries). */
export const withHidden = (hidden: readonly NavItem[], id: NavItem, hide: boolean): NavItem[] => NAV_ITEMS.filter((n) => (n === id ? hide : hidden.includes(n)))
