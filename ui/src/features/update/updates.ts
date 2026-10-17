import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type UpdateStatus } from '../../shared/api'
import { saveSessionNow } from '../player/session'
import { usePlayer } from '../player/store'

/** What the background updater is doing (Settings › About). */
export const useUpdate = create<{ status: UpdateStatus | null }>(() => ({ status: null }))

// A quiet moment: nothing played for 15 s and no click or key for a minute.
const SILENT_MS = 15_000
const UNTOUCHED_MS = 60_000
const LOOK_EVERY = 5_000

/** Install the downloaded update: session saved first, the app closes and comes back as it was. */
export async function installUpdate() {
  const s = useUpdate.getState().status
  if (s?.state !== 'ready') return
  useStore.getState().notify(`Updating to ${s.version}… back in a few seconds`, { kind: 'info' })
  await saveSessionNow()
  await api.updateInstall().catch((e) => useStore.getState().notify(String(e), { kind: 'error' }))
}

/** Pure: may an update install now? */
export function quietNow(now: number, { playing, lastSound, lastInput }: { playing: boolean; lastSound: number; lastInput: number }): boolean {
  return !playing && now - lastSound >= SILENT_MS && now - lastInput >= UNTOUCHED_MS
}

/** Follows the updater; with automatic updates on, a ready update installs at the first quiet moment. Returns cleanup. */
export function startUpdates(): () => void {
  let lastSound = Date.now()
  let lastInput = Date.now()
  const touched = () => void (lastInput = Date.now())
  window.addEventListener('pointerdown', touched)
  window.addEventListener('keydown', touched)
  const unsub = usePlayer.subscribe((s) => {
    if (s.playing) lastSound = Date.now()
  })
  const look = setInterval(() => {
    const ready = useUpdate.getState().status?.state === 'ready'
    if (!ready || !useSettings.getState().settings.autoUpdate) return
    if (quietNow(Date.now(), { playing: usePlayer.getState().playing, lastSound, lastInput })) void installUpdate()
  }, LOOK_EVERY)
  const set = (status: UpdateStatus) => useUpdate.setState({ status })
  void api
    .updateStatus()
    .then(set)
    .catch(() => {})
  const off = api.onUpdate(set)
  return () => {
    clearInterval(look)
    unsub()
    window.removeEventListener('pointerdown', touched)
    window.removeEventListener('keydown', touched)
    void off.then((f) => f())
  }
}
