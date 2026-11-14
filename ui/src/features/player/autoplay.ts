import { djMore } from './autoDj'
import { similarForQueue } from './radio'
import { onQueueEnd, usePlayer } from './store'

/** Songs added when Up next runs out. */
const MORE = 15

/**
 * Up next ran out (always: there is no switch any more, docs/recommendation.md): songs like the whole queue, scored by your taste with
 * a dose of the new and a cap per artist (similarRank.ts, score.ts, radio.ts).
 * The Auto-DJ on: its own picks instead (autoDj.ts). False = nothing to add.
 */
async function similarSongs(): Promise<boolean> {
  if (usePlayer.getState().dj) return djMore()
  const { list, index, enqueue } = usePlayer.getState()
  const more = await similarForQueue(list, index, MORE)
  if (!more.length) return false
  // The app's pick, not the user's: at the end, outside "added by you".
  enqueue(more, false, false)
  return true
}

onQueueEnd(similarSongs)
