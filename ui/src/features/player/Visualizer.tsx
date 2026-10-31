import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { vizMenu } from '../menus'
import { useLive } from './live'
import { usePlayer } from './store'
import { openVizFull, useVizFull } from './vizFull'
import { VizCanvas } from './VizCanvas'

/**
 * The music under the cover (Settings › Playback › Visualizer), drawn by a worker (VizCanvas.tsx) in the look picked
 * there. A double click or V takes it full screen; right-click picks the look. Quiet while the full screen is up.
 */
export function Visualizer() {
  const look = useSettings((s) => s.settings.visualizerStyle)
  const full = useVizFull((s) => s.open)
  // YouTube's sound can't be heard here (setting off, capture refused): said under the bars rather than a flat line.
  const youtube = usePlayer((s) => s.now?.via === 'youtube')
  const liveYoutube = useSettings((s) => s.settings.liveYoutube)
  const error = useLive((l) => l.error)
  const why = !youtube ? undefined : !liveYoutube ? tr('YouTube’s sound isn’t listened to: turn on “Process YouTube’s sound” in Settings › Playback') : error && tr('Not on this video: {error}. It plays as usual.', { error })
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div onDoubleClick={openVizFull} onContextMenu={onMenu(vizMenu)} className="h-12 w-full">
        <VizCanvas look={look} listen={!full} />
      </div>
      {why && <p className="text-center text-[0.6875rem] text-ink-3">{why}</p>}
    </div>
  )
}
