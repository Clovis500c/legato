import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import type { MenuEntry } from '../../shared/ui/ContextMenu'
import type { Picks } from './browse'

// The column browser's state and menu entry, apart from its panes (ColumnBrowser.tsx, loaded when it is on): Songs needs
// these at launch, not the panes.

/** What the panes picked, kept while the app runs: another page and back finds it. */
export const useBrowse = create<Picks>(() => ({ genres: [], artists: [], albums: [] }))

/** Songs' Display options: the column browser on or off. */
export function browserEntry(): MenuEntry {
  const { settings, update } = useSettings.getState()
  return { label: tr('Column browser'), checked: settings.columnBrowser, onSelect: () => update({ columnBrowser: !settings.columnBrowser }) }
}
