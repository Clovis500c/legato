import { ACTIONS, bindings, comboLabel } from '../../app/keys'
import { useSettings } from '../../app/settings'
import { RUN } from '../../app/shortcuts'
import { useStore, type View } from '../../app/store'
import { msg, tr } from '../../shared/i18n/i18n'
import { SETTINGS_SECTIONS } from '../menus'
import { SETTINGS_INDEX } from '../settings/search'
import type { Command } from './commands'

/** Pages the sidebar and the top bar open, with words people may type for them. */
const PAGES: [View, string, string?][] = [
  [{ name: 'home' }, msg('Home')],
  [{ name: 'songs' }, msg('Songs'), msg('library all tracks liked')],
  [{ name: 'albums' }, msg('Albums')],
  [{ name: 'artists' }, msg('Artists')],
  [{ name: 'mixes' }, msg('Mixes'), msg('daily discover radio')],
  [{ name: 'radio' }, msg('Radio'), msg('internet stations live stream')],
  [{ name: 'stats' }, msg('Stats'), msg('statistics listening history top')],
  [{ name: 'health' }, msg('Library health'), msg('missing files broken videos covers tags duplicates fix')],
  [{ name: 'add' }, msg('Add music'), msg('import playlist link file spotify youtube apple')],
  [{ name: 'addons' }, msg('Add-ons'), msg('plugins extensions')],
  [{ name: 'settings', section: 'general' }, msg('Settings'), msg('preferences options')],
]

/**
 * The search bar's pages, actions (the shortcuts table, with the keys bound now) and settings rows: everything the app
 * opens or does, found by name. Built as the list opens: keys and language as they are then.
 */
export function commandList(): Command[] {
  const { go } = useStore.getState()
  const bound = bindings(useSettings.getState().settings.shortcuts)
  const section = Object.fromEntries(SETTINGS_SECTIONS)
  const also = (words?: string) => (words ? `${words} ${tr(words)}` : '')
  return [
    ...PAGES.map(([to, label, words]): Command => ({ key: `page:${label}`, kind: 'page', label: tr(label), sub: tr('Page'), words: `${label} ${also(words)}`, run: () => go(to) })),
    // Search is this field; Settings is a page above.
    ...ACTIONS.filter((a) => !a.globalOnly && a.id !== 'search' && a.id !== 'settings').map((a): Command => ({ key: `action:${a.id}`, kind: 'action', label: tr(a.label), sub: tr('Action'), words: a.label, keys: bound[a.id].keys?.split('+').map(comboLabel), run: RUN[a.id] })),
    ...SETTINGS_INDEX.map((e): Command => ({ key: `setting:${e.section}:${e.label}`, kind: 'setting', label: tr(e.label), sub: tr('Settings › {section}', { section: tr(section[e.section]) }), words: `${e.label} ${also(e.keywords)} ${e.extra ?? ''}`, run: () => go({ name: 'settings', section: e.section, focus: e.label }) })),
  ]
}
