import { listen } from '@tauri-apps/api/event'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { usePlayer } from './store'

/**
 * Headphones unplugged, Bluetooth headset or speaker off (src-tauri `unplug.rs`): paused at once, no fade, before the
 * speakers play it to the room. The notice's Play goes on where the music stopped.
 */
export function startUnplugPause(): () => void {
  const off = listen('audio-output-lost', () => {
    const p = usePlayer.getState()
    if (!useSettings.getState().settings.pauseOnUnplug || !p.playing) return
    p.pauseNow()
    useStore.getState().notify(tr('Paused: your headphones or speaker disconnected'), { action: { label: tr('Play'), run: () => usePlayer.getState().toggle() } })
  })
  return () => void off.then((f) => f())
}

/**
 * A call starts (Windows' communications ducking, same Rust module): paused, with the pause fade; it ends: plays on,
 * unless the music was played or changed meanwhile. Setting `pauseOnCall`; off, Windows lowers it instead.
 */
export function startCallPause(): () => void {
  // Play paused for the call (its playId), until the call ends.
  let held: number | null = null
  const off = listen<boolean>('audio-call', ({ payload: on }) => {
    const p = usePlayer.getState()
    if (!on) {
      if (held !== null && !p.playing && p.playId === held) p.toggle()
      held = null
      return
    }
    if (!useSettings.getState().settings.pauseOnCall || !p.playing) return
    p.toggle()
    held = p.playId
    useStore.getState().notify(tr('Paused for a call: the music plays on when it ends'))
  })
  return () => void off.then((f) => f())
}
