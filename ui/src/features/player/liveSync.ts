import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { startEditor, useEditor } from '../editor/editor'
import { useDeviceEq } from './deviceEq'
import { neutral, withDeviceEq } from './effects'
import { refreshOutputs, useOutputs } from './outputs'
import { overlapDue } from './fade'
import { sendLive, setEnding, startLive } from './live'
import { useLoudListeners } from './loudFeed'
import { claimViz, useVizListeners, viz as frames } from './vizFrames'
import { wantsWave } from './vizLooks'
import { songFade, usePlayer } from './store'
import { startLevelling } from './ytLevel'

// Who plays now, for levels: the native engine (local files, server songs, previews) or YouTube. Spotify: its own app, none.
const playing = () => {
  const via = usePlayer.getState().now?.via
  return via === 'local' || via === 'server' || via === 'preview' ? 'native' : via === 'youtube' ? 'youtube' : null
}

/** Live processing follows the settings (Settings › Advanced › Sound) and the Live Editor. Mounted once, by the player bar. */
export function useLiveSync() {
  const { adaptiveSound, adaptiveLevel, coverPulse, earlyEnds, skipSilence, liveYoutube, fine, wave, levelling } = useSettings(
    useShallow(({ settings: s }) => ({ levelling: s.levelling, adaptiveSound: s.adaptiveSound, adaptiveLevel: s.adaptiveLevel, coverPulse: s.coverPulse, earlyEnds: s.earlyEnds, skipSilence: s.skipSilence, liveYoutube: s.liveYoutube, fine: s.visualizerBands === 'twelfth', wave: wantsWave(s.visualizerStyle) })),
  )
  // The 60 Hz frames (Visualizer v2): YouTube's side makes them only while a view listens.
  const viz = useVizListeners((s) => s.n > 0)
  // The loudness meter reads the levels, not the frames.
  const meter = useLoudListeners((s) => s.n > 0)
  const own = useEditor((s) => s.effects)
  // Equalizer per output device: the picked output's preset joins the song's own edit.
  const device = useOutputs((s) => s.current)
  const preset = useDeviceEq((s) => s.map[device ?? 'default'])
  const perDevice = useSettings((s) => s.settings.eqPerDevice)
  const effects = useMemo(() => (perDevice ? withDeviceEq(own, preset) : own), [own, preset, perDevice])
  // The output Rust brought back at start is only known here once asked: else the default's preset would play.
  useEffect(() => {
    if (perDevice) refreshOutputs()
  }, [perDevice])
  // This page owns the visualizer stream from the start: a worker left by a page before a reload is stopped.
  useEffect(() => claimViz(), [])
  // Twelfths: the engine's frames in 121 bands; the scopes: with their wave blocks (YouTube's through the wish below).
  useEffect(() => frames.setAsk({ fine, wave }), [fine, wave])
  useEffect(() => startLive(playing), [])
  useEffect(() => startEditor(), [])
  // Volume levelling: YouTube songs measured as they play, levelled from their second play on.
  useEffect(() => startLevelling(() => levelling), [levelling])
  // Fade out under way: Adaptive Sound holds. Synchronous with the position, so the playing frame hears it before an
  // overlap hands the live link to the next song's embed.
  useEffect(() => usePlayer.subscribe((s) => setEnding(overlapDue(s.positionMs, s.durationMs, songFade(s)))), [])
  useEffect(() => {
    // Bypassed edits keep processing attached: A / B switches at once. Levels alone (moving cover, early ends) only listen.
    const process = adaptiveSound || levelling !== 'off' || !neutral({ ...effects, on: true })
    sendLive({ on: process || coverPulse || viz || meter, levels: process || coverPulse || meter, ends: earlyEnds || skipSilence, listen: !process, adaptive: adaptiveSound, targetLufs: adaptiveLevel, viz, fine, wave, youtube: liveYoutube, effects })
  }, [levelling, adaptiveSound, adaptiveLevel, coverPulse, earlyEnds, skipSilence, liveYoutube, effects, viz, meter, fine, wave])
}
