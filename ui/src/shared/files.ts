import { open, save, type DialogFilter, type OpenDialogOptions, type SaveDialogOptions } from '@tauri-apps/plugin-dialog'
import { api } from './api'
import { phoneApp } from './platform'

/**
 * Files through the system's own dialogs (src-tauri/src/picked.rs). Android's picker gives content:// addresses that no
 * command can open: a picked file is copied into the app's cache first, a saved one is written there, then copied out.
 */

const isAddress = (s: string) => s.startsWith('content://')
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

// Android's picker goes by the type a file's provider gives it: picture and video types match, a .theme or .legato
// file has none it knows (greyed out), a CSV's varies by provider.
const MEDIA = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'])

/**
 * The dialog's filters, Android's way on a phone. Picking: media filters kept, the others any file (the command says
 * when it's the wrong one). Saving: one type, the first filter's when it's a media one, else a plain file.
 */
export function pickerFilters(filters: DialogFilter[] | undefined, phone: boolean, saving: boolean): DialogFilter[] | undefined {
  if (!phone || !filters?.length) return filters
  const media = filters.every((f) => f.extensions.every((e) => MEDIA.has(e.toLowerCase())))
  if (!saving) return media ? filters : undefined
  const first = filters[0]
  return [{ name: first.name, extensions: [media && first.extensions[0] ? first.extensions[0] : 'application/octet-stream'] }]
}

/** A file the user picked, as a path the commands open; null when cancelled. */
export async function pickFile(options: Omit<OpenDialogOptions, 'multiple' | 'directory'>): Promise<string | null> {
  const picked = await open({ ...options, filters: pickerFilters(options.filters, phoneApp, false) })
  if (typeof picked !== 'string') return null
  return isAddress(picked) ? api.pickedIn(picked) : picked
}

/**
 * A file written where the user picked. write gets the path to write (the picked one, or a cache file on a phone) and
 * may answer the path it really wrote. The file's name there; null when cancelled.
 */
export async function saveFile(options: SaveDialogOptions, write: (path: string) => Promise<string | void>): Promise<string | null> {
  const target = await save({ ...options, filters: pickerFilters(options.filters, phoneApp, true) })
  if (!target) return null
  if (!isAddress(target)) return baseName((await write(target)) || target)
  const temp = await api.pickedTemp(baseName(options.defaultPath ?? 'file'))
  return api.pickedOut((await write(temp)) || temp, target)
}
