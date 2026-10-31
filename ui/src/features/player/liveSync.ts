import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { startEditor, useEditor } from '../editor/editor'
import { neutral } from './effects'
import { overlapDue } from './fade'
import { sendLive, setEnding, startLive } from './live'
import { claimViz, useVizListeners } from './vizFrames'
import { usePlayer } from './store'

// Who plays now, for levels: the native engine (local files, previews) or YouTube. Spotify: its own app, none.
const playing = () => {
  const via = usePlayer.getState().now?.via
  return via === 'local' || via === 'preview' ? 'native' : via === 'youtube' ? 'youtube' : null
}

/** Live processing follows the settings (Settings › Advanced › Sound) and the Live Editor. Mounted once, by the player bar. */
export function useLiveSync() {
  const { adaptiveSound, adaptiveLevel, coverPulse, earlyEnds, skipSilence, liveYoutube } = useSettings(
    useShallow(({ settings: s }) => ({ adaptiveSound: s.adaptiveSound, adaptiveLevel: s.adaptiveLevel, coverPulse: s.coverPulse, earlyEnds: s.earlyEnds, skipSilence: s.skipSilence, liveYoutube: s.liveYoutube })),
  )
  // The 60 Hz frames (Visualizer v2): YouTube's side makes them only while a view listens.
  const viz = useVizListeners((s) => s.n > 0)
  const effects = useEditor((s) => s.effects)
  // This page owns the visualizer stream from the start: a worker left by a page before a reload is stopped.
  useEffect(() => claimViz(), [])
  useEffect(() => startLive(playing), [])
  useEffect(() => startEditor(), [])
  // Fade out under way: Adaptive Sound holds. Synchronous with the position, so the playing frame hears it before an
  // overlap hands the live link to the next song's embed.
  useEffect(() => usePlayer.subscribe((s) => setEnding(overlapDue(s.positionMs, s.durationMs, s.fade))), [])
  useEffect(() => {
    // Bypassed edits keep processing attached: A / B switches at once. Levels alone (moving cover, early ends) only listen.
    const process = adaptiveSound || !neutral({ ...effects, on: true })
    sendLive({ on: process || coverPulse || viz, levels: process || coverPulse, ends: earlyEnds || skipSilence, listen: !process, adaptive: adaptiveSound, targetLufs: adaptiveLevel, viz, youtube: liveYoutube, effects })
  }, [adaptiveSound, adaptiveLevel, coverPulse, earlyEnds, skipSilence, liveYoutube, effects, viz])
}
