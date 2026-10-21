import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { startEditor, useEditor } from '../editor/editor'
import { neutral } from './effects'
import { sendLive, startLive } from './live'
import { usePlayer } from './store'

// Who plays now, for levels: the native engine (local files, previews) or YouTube. Spotify: its own app, none.
const playing = () => {
  const via = usePlayer.getState().now?.via
  return via === 'local' || via === 'preview' ? 'native' : via === 'youtube' ? 'youtube' : null
}

/** Live processing follows the settings (Settings › Advanced › Sound) and the Live Editor. Mounted once, by the player bar. */
export function useLiveSync() {
  const { adaptiveSound, adaptiveLevel, coverPulse, liveYoutube } = useSettings(
    useShallow(({ settings: s }) => ({ adaptiveSound: s.adaptiveSound, adaptiveLevel: s.adaptiveLevel, coverPulse: s.coverPulse, liveYoutube: s.liveYoutube })),
  )
  const effects = useEditor((s) => s.effects)
  useEffect(() => startLive(playing), [])
  useEffect(() => startEditor(), [])
  useEffect(() => {
    // Bypassed edits keep processing attached: A / B switches at once.
    sendLive({ on: adaptiveSound || coverPulse || !neutral({ ...effects, on: true }), adaptive: adaptiveSound, targetLufs: adaptiveLevel, youtube: liveYoutube, effects })
  }, [adaptiveSound, adaptiveLevel, coverPulse, liveYoutube, effects])
}
