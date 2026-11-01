import { useStore } from '../../app/store'
import { api, type Dropped } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { usePlayer } from './store'

/**
 * Explorer's drop on the window: songs and folders join the library (folders watched), then play. Songs new to the
 * library wait for the notice's Play (a drop can't say Shift was held). False: nothing taken, an image alone is a shared
 * playlist's QR code.
 */
export async function takeDrop(paths: string[]): Promise<boolean> {
  let r: Dropped
  try {
    r = await api.addDropped(paths)
  } catch (e) {
    useStore.setState({ error: String(e) })
    return true
  }
  if (!r.paths.length && !r.folders) return false
  const { refresh, notify } = useStore.getState()
  await refresh()
  const order = [...r.paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const play = () => {
    const byPath = new Map(useStore.getState().tracks.map((t) => [t.ids.local, t]))
    const list = order.flatMap((p) => byPath.get(p) ?? [])
    if (list.length) usePlayer.getState().playTracks(list, 0)
  }
  if (r.added) notify(trn(r.added, 'Added {n} song', 'Added {n} songs'), { action: { label: tr('Play'), run: play } })
  else if (order.length) play()
  else notify(tr('Folder added'))
  return true
}
