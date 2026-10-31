import { X } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { useSettings } from '../../app/settings'
import { artistName } from '../../shared/artistName'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { vizMenu } from '../menus'
import { usePlayer } from './store'
import { canVizFull, closeVizFull } from './vizFull'
import { VizCanvas } from './VizCanvas'

/** The visualizer over the whole window (vizFull.ts): the look picked in Settings, right-click for another, Esc or a double click leaves. */
export function VizScreen() {
  const look = useSettings((s) => s.settings.visualizerStyle)
  const now = usePlayer((s) => s.now)
  // Spotify plays in its own app, or nothing plays: nothing to draw.
  useEffect(() => {
    if (!canVizFull()) closeVizFull()
  }, [now?.via, now])
  return (
    <div role="dialog" aria-label={tr('Visualizer')} onContextMenu={onMenu(vizMenu)} onDoubleClick={closeVizFull} className="fade-in fixed inset-0 z-40 isolate flex flex-col overflow-hidden bg-bg text-ink">
      <RoundButton label={tr('Leave full screen')} kind="plain" size="md" onClick={closeVizFull} className="absolute top-4 right-4 z-10">
        <X size={22} />
      </RoundButton>
      <div className="min-h-0 flex-1 px-[5vw] pt-[9vh] pb-[3vh]">
        <VizCanvas look={look} />
      </div>
      {now && (
        <footer className="shrink-0 px-[5vw] pb-6">
          <p className="truncate text-sm font-semibold">{now.title}</p>
          <p className="truncate text-xs text-ink-2">{artistName(now.artist)}</p>
        </footer>
      )}
    </div>
  )
}
