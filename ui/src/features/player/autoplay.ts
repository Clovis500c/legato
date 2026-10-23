import { useSettings } from '../../app/settings'
import { similarTo } from './radio'
import { onQueueEnd, usePlayer } from './store'

/** Songs added when Up next runs out. */
const MORE = 15

/** Up next ran out (setting autoplay, "Then, similar songs"): songs like the last few (radio.ts). False = nothing to add. */
async function similarSongs(): Promise<boolean> {
  if (!useSettings.getState().settings.autoplay) return false
  const { list, index, enqueue } = usePlayer.getState()
  const recent = list.slice(Math.max(0, index - 4), index + 1)
  const more = await similarTo(recent, new Set(list.map((t) => t.ids.youtube ?? `#${t.id}`)), MORE)
  if (!more.length) return false
  enqueue(more, false)
  return true
}

onQueueEnd(similarSongs)
