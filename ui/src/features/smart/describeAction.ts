import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { askText } from '../../shared/ui/Ask'
import { saveSmart } from './actions'
import { describePlaylist } from './describe'
import { newSmartList } from './rules'

/** Sidebar › New playlist › Describe a playlist…: a smart playlist made from the words typed (`describePlaylist`). */
export async function describeSmart() {
  const { tracks, notify, go } = useStore.getState()
  const text = await askText({ title: tr('Describe the playlist: a decade, a genre of your library, calm or fast, new…'), ok: tr('Create') })
  if (!text) return
  const d = describePlaylist(text, tracks)
  if (!d) return notify(tr('No rule found in these words. Try a decade, a genre or artist of your library, calm or fast, new…'))
  const list = { ...newSmartList(d.name), match: d.match, rules: d.rules, sort: d.sort }
  saveSmart(list)
  go({ name: 'smart', id: list.id })
  if (d.left.length) notify(tr('Not understood: {words}', { words: d.left.join(' ') }))
}
