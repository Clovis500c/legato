import { useSettings } from '../../app/settings'
import { makeAwake, pageAwake } from '../../shared/awake'
import { usePlayer } from './store'

/** Settings › Playback › Keep the screen on: the screen stays on while a song plays and the page shows. */
export function startScreenAwake(): () => void {
  const awake = makeAwake(pageAwake())
  let last: boolean | null = null
  const sync = () => {
    const on = useSettings.getState().settings.keepScreenOn && usePlayer.getState().playing
    if (on === last) return
    last = on
    awake.set(on)
  }
  sync()
  const offPlayer = usePlayer.subscribe(sync)
  const offSettings = useSettings.subscribe(sync)
  return () => {
    offPlayer()
    offSettings()
    awake.dispose()
  }
}
