import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { reportError } from '../../shared/diag'
import { msg } from '../../shared/i18n/i18n'
import type { PhoneBridge } from './phoneMic'

/** Android's side of the phone's songs (`MainActivity.kt`, the app's own page only). */
const bridge = () => (globalThis as unknown as { LegatoMusic?: PhoneBridge }).LegatoMusic

/** Android's own refusal, with "Open app info" after it. */
export const MUSIC_REFUSED = msg('Android keeps Legato away from your music. Allow it in Legato’s app info › Permissions.')

/** Android's answer: the folders a phone keeps songs in (a JSON list of paths), or "no" when Legato may not read them. */
export function folderList(answer: unknown): string[] | null {
  if (typeof answer !== 'string' || answer === 'no') return null
  try {
    const list: unknown = JSON.parse(answer)
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string' && f.startsWith('/')) : null
  } catch {
    return null
  }
}

/**
 * The phone's song folders (Music, Download) once Android lets Legato read them, its own dialog the first time; null
 * when refused. 'check' shows no dialog. No bridge (a PC, the demo): null.
 */
export function phoneFolders(how: 'ask' | 'check' = 'ask', music = bridge()): Promise<string[] | null> {
  if (!music) return Promise.resolve(null)
  return new Promise((resolve) => {
    music.onmessage = (e) => {
      music.onmessage = null
      resolve(folderList(e.data))
    }
    music.postMessage(how)
  })
}

/** The watched folders with the phone's added, each once. */
export const withPhone = (folders: string[], phone: string[]) => [...new Set([...folders, ...phone])]

/**
 * Songs come by USB or from other apps while Legato is closed, past the folder watcher: scanned again at launch, only
 * while Android still lets Legato read them (a scan that reads nothing takes their songs out of the library).
 */
export async function rescanPhone(music = bridge()) {
  if (!music || !(await api.localFolders()).length || !(await phoneFolders('check', music))) return
  await api.rescanLocal()
  await useStore.getState().refreshChanged()
}

/** Deferred start (app/deferred.ts): the scan runs on its own, the ready signal doesn't wait for it. */
export async function startPhoneMusic(): Promise<() => void> {
  void rescanPhone().catch((e) => reportError('library', e, 'The phone’s songs were not scanned again'))
  return () => {}
}
