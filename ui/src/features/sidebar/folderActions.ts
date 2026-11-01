import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import type { PlaylistFolder } from '../../shared/theme/theme'
import { askText } from '../../shared/ui/Ask'
import { addFolder, moveToFolder, togglePin } from './arrange'

const settings = () => useSettings.getState()
const folders = () => settings().settings.playlistFolders
const save = (playlistFolders: PlaylistFolder[]) => settings().update({ playlistFolders })

/** Right-click › Pin to top / Unpin (playlistKey). */
export const togglePinned = (key: string) => settings().update({ pinnedPlaylists: togglePin(settings().settings.pinnedPlaylists, key) })

/** Right-click › Move to folder: into that folder, or out of it (null). */
export const setFolder = (key: string, id: string | null) => save(moveToFolder(folders(), key, id))

/** New folder, named by the user; holding the playlist it was made from. */
export async function newFolder(key?: string) {
  const name = (await askText({ title: tr('New folder'), ok: tr('Create'), value: tr('New folder') }))?.trim()
  if (name) save(addFolder(folders(), name, key))
}

export const toggleFolder = (id: string) => save(folders().map((f) => (f.id === id ? { ...f, open: !f.open } : f)))

export async function renameFolder(f: PlaylistFolder) {
  const name = (await askText({ title: tr('Rename folder'), ok: tr('Rename'), value: f.name }))?.trim()
  if (name && name !== f.name) save(folders().map((x) => (x.id === f.id ? { ...x, name } : x)))
}

/** The folder goes, its playlists stay (back among the others); the notice's Undo puts it back. */
export function deleteFolder(id: string) {
  const before = folders()
  save(before.filter((f) => f.id !== id))
  useStore.getState().notify(tr('Folder deleted: its playlists stay'), { action: { label: tr('Undo'), run: () => save(before) } })
}
