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
