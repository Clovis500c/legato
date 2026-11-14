import { useSettings } from '../../app/settings'
import { djMore } from './autoDj'
import { similarForQueue } from './radio'
import { onQueueEnd, usePlayer } from './store'

/** Songs added when Up next runs out. */
const MORE = 15

/**
 * Up next ran out (setting autoplay, "Then, similar songs", or a radio playing): songs like the whole queue, ranked by what you
 * rate and play, never one artist three times running (similarRank.ts, radio.ts).
 * The Auto-DJ on: its own picks instead (autoDj.ts). False = nothing to add.
 */
async function similarSongs(): Promise<boolean> {
  if (usePlayer.getState().dj) return djMore()
  if (!useSettings.getState().settings.autoplay && !usePlayer.getState().radio) return false
  const { list, index, enqueue } = usePlayer.getState()
  const more = await similarForQueue(list, index, MORE)
  if (!more.length) return false
  // The app's pick, not the user's: at the end, outside "added by you".
  enqueue(more, false, false)
  return true
}

onQueueEnd(similarSongs)
