import { ListPlus, PencilSimple, Trash } from '@phosphor-icons/react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { ask } from '../../shared/ui/Ask'
import { type MenuEntry } from '../../shared/ui/ContextMenu'
import { type SmartList } from '../../shared/theme/theme'

// Smart list actions, apart from the page: the sidebar needs them at launch, the page loads on its first visit.
export function useSmartList(id: string) {
  return useSettings((s) => s.settings.smartLists.find((l) => l.id === id))
}

export function saveSmart(list: SmartList) {
  const all = useSettings.getState().settings.smartLists
  useSettings.getState().update({ smartLists: all.some((l) => l.id === list.id) ? all.map((l) => (l.id === list.id ? list : l)) : [...all, list] })
}

export async function deleteSmart(list: SmartList) {
  if (!(await ask({ title: tr('Delete “{name}”?', { name: list.name }), body: tr('Only the rules go: your songs stay in the library.'), ok: tr('Delete') }))) return
  useSettings.getState().update({ smartLists: useSettings.getState().settings.smartLists.filter((l) => l.id !== list.id) })
  const v = useStore.getState().view
  if (v.name === 'smart' && v.id === list.id) useStore.getState().go({ name: 'home' })
}

/** Today's songs copied into a normal playlist (which then stays as it is). */
async function saveAsPlaylist(list: SmartList, ids: number[]) {
  const { refreshChanged, notify, go } = useStore.getState()
  try {
    const id = await api.editPlaylist({ type: 'create', name: list.name })
    if (id === null) return
    if (ids.length) await api.editPlaylist({ type: 'add', id, trackIds: ids })
    await refreshChanged()
    notify(tr('Saved as the playlist “{name}”', { name: list.name }), { action: { label: tr('Open'), run: () => go({ name: 'playlist', id }) } })
  } catch (e) {
    notify(String(e), { kind: 'error' })
  }
}

export function smartMenu(list: SmartList, ids: number[], edit?: () => void): MenuEntry[] {
  return [
    edit && { label: tr('Edit rules'), icon: <PencilSimple size={16} />, onSelect: edit },
    { label: tr('Save as a playlist'), icon: <ListPlus size={16} />, onSelect: () => void saveAsPlaylist(list, ids) },
    '-',
    { label: tr('Delete'), icon: <Trash size={16} />, danger: true, onSelect: () => void deleteSmart(list) },
  ]
}
