import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import type { VisualizerStyle } from '../../shared/theme/theme'
import { onMenu } from '../../shared/ui/ContextMenu'
import { vizMenu } from '../menus'
import { useLive } from './live'
import { usePlayer } from './store'
import { useCoverFull } from './coverFull'
import { openVizFull, useVizFull } from './vizFull'
import { VizCanvas } from './VizCanvas'
import { useNextLookClick } from './vizClick'

/**
 * The music under the cover (Settings › Playback › Visualizer), drawn by a worker (VizCanvas.tsx) in the look picked
 * there. A click: the next look; a double click or V takes it full screen; right-click picks the look. Quiet while the
 * full screen is up.
 */
export function Visualizer() {
  const picked = useSettings((s) => s.settings.visualizerStyle)
  // Radial goes around a big cover (Stage, NowPlaying.tsx); the strip is too small for it.
  const look = picked === 'radial' ? 'bars' : picked
  const full = useVizFull((s) => s.open)
  const covered = useCoverFull((s) => s.open)
  // YouTube's sound can't be heard here (setting off, capture refused): said under the bars rather than a flat line.
  const youtube = usePlayer((s) => s.now?.via === 'youtube')
  const liveYoutube = useSettings((s) => s.settings.liveYoutube)
  const error = useLive((l) => l.error)
  const next = useNextLookClick()
  const why = !youtube ? undefined : !liveYoutube ? tr('YouTube’s sound isn’t listened to: turn on “Process YouTube’s sound” in Settings › Playback') : error && tr('Not on this video: {error}. It plays as usual.', { error })
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div onClick={next} onDoubleClick={openVizFull} onContextMenu={onMenu(vizMenu)} className="h-12 w-full cursor-pointer">
        <VizCanvas look={look} listen={!full && !covered} />
      </div>
      {why && <p className="text-center text-[0.6875rem] text-ink-3">{why}</p>}
    </div>
  )
}

/** Bars in a backdrop or a thin strip for the looks that need room or read as numbers: the ring, the particles, the vectorscope, the loudness meter. */
const roomy = (look: VisualizerStyle): VisualizerStyle => (look === 'radial' || look === 'particles' || look === 'vectorscope' || look === 'loudness' ? 'bars' : look)

/**
 * The visualizer big and faint across the bottom of Now Playing, behind the song (Settings › Playback › Visualizer
 * behind Now Playing): the look picked, bars for those that need room (`roomy`: Radial's ring stays around the cover). No
 * clicks: they go through.
 */
export function VizBackdrop() {
  const picked = useSettings((s) => s.settings.visualizerStyle)
  const full = useVizFull((s) => s.open)
  const covered = useCoverFull((s) => s.open)
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 opacity-20">
      <VizCanvas look={roomy(picked)} listen={!full && !covered} />
    </div>
  )
}

/** The mini player's thin visualizer (MiniViz.tsx loads it): bars for the looks that need room; quiet under Now Playing or a full screen. */
export function MiniStrip() {
  const picked = useSettings((s) => s.settings.visualizerStyle)
  const nowPlaying = usePlayer((s) => s.full)
  const full = useVizFull((s) => s.open)
  const covered = useCoverFull((s) => s.open)
  return <VizCanvas look={roomy(picked)} listen={!nowPlaying && !full && !covered} />
}

/** The Radial look behind a big cover (Stage in NowPlaying.tsx): fills its parent, a square; quiet while a full screen is up. */
export function RadialRing() {
  const full = useVizFull((s) => s.open)
  const covered = useCoverFull((s) => s.open)
  return <VizCanvas look="radial" listen={!full && !covered} />
}
