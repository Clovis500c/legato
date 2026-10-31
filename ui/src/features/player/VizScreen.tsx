import { X } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { useSettings } from '../../app/settings'
import { artistName } from '../../shared/artistName'
import { bigTrackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { vizMenu } from '../menus'
import { useNowTrack, usePlayer } from './store'
import { RING_COVER } from './vizDraw'
import { canVizFull, closeVizFull } from './vizFull'
import { VizCanvas } from './VizCanvas'

/**
 * The visualizer over the whole window (vizFull.ts): the look picked in Settings, right-click for another, Esc or a
 * double click leaves. Radial puts the round cover in the middle of its ring.
 */
export function VizScreen() {
  const look = useSettings((s) => s.settings.visualizerStyle)
  const now = usePlayer((s) => s.now)
  const track = useNowTrack()
  // Spotify plays in its own app, or nothing plays: nothing to draw.
  useEffect(() => {
    if (!canVizFull()) closeVizFull()
  }, [now?.via, now])
  return (
    <div role="dialog" data-viz-screen aria-label={tr('Visualizer')} onContextMenu={onMenu(vizMenu)} onDoubleClick={closeVizFull} className="fade-in fixed inset-0 z-40 isolate flex flex-col overflow-hidden bg-bg text-ink">
      <RoundButton label={tr('Leave full screen')} kind="plain" size="md" onClick={closeVizFull} className="absolute top-4 right-4 z-10">
        <X size={22} />
      </RoundButton>
      {look === 'radial' ? (
        <div className="grid min-h-0 flex-1 place-items-center px-[5vw] pt-[9vh] pb-[3vh]" style={{ containerType: 'size' }}>
          <div className="relative" style={{ width: 'min(100cqw, 100cqh)', aspectRatio: '1' }}>
            <VizCanvas look={look} />
            <div className="absolute top-1/2 left-1/2 aspect-square -translate-x-1/2 -translate-y-1/2" style={{ width: `${RING_COVER * 100}%` }}>
              <Cover title={track?.album ?? now?.title ?? ''} art={track && bigTrackArt(track)} size={200} eager className="size-full! rounded-full! text-[3.5rem]! shadow-[0_12px_40px_var(--shadow)]" />
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-[5vw] pt-[9vh] pb-[3vh]">
          <VizCanvas look={look} />
        </div>
      )}
      {now && (
        <footer className="shrink-0 px-[5vw] pb-6">
          <p className="truncate text-sm font-semibold">{now.title}</p>
          <p className="truncate text-xs text-ink-2">{artistName(now.artist)}</p>
        </footer>
      )}
    </div>
  )
}
