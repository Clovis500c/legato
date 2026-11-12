import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { askText } from '../../shared/ui/Ask'
import { usePlayer } from '../player/store'

/**
 * Artist page › "Walk to another artist…": asks for a library artist and plays a walk from this one to it, through the
 * artists you listen to together (`walk::artist_path`), a few songs of each.
 */
export async function walkFrom(artist: string) {
  const { notify, tracks } = useStore.getState()
  const to = await askText({ title: tr('Walk to which artist of your library?'), ok: tr('Walk') })
  if (!to) return
  try {
    const walk = await api.artistPath(artist, to)
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const list = walk?.trackIds.flatMap((id) => byId.get(id) ?? []) ?? []
    if (!walk || !list.length) return notify(tr('No walk found: nothing you listen to joins these two artists'))
    usePlayer.getState().playTracks(list, 0)
    if (usePlayer.getState().list === list) usePlayer.setState({ from: walk.artists.join(' → ') })
    notify(trn(walk.artists.length, 'Walking through {n} artist', 'Walking through {n} artists'))
  } catch (e) {
    notify(String(e), { kind: 'error' })
  }
}
