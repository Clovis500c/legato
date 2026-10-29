import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { LedChip } from '../../shared/ui/controls'
import { playerMenu } from '../menus'
import { LyricsPanel } from './LyricsPanel'
import { VideoSlot } from './NowPlaying'
import { useNowTrack, usePlayer } from './store'
import { UpNext } from './UpNext'

const LOOK = 'rounded-lg bg-panel p-3'

/**
 * Mini player on top of the right panel (setting miniPlace 'panel', user's pick 2026-10-29: the sidebar shows the library
 * only). YouTube: its video, 200 px tall (YouTube's minimum, sides cut), shown even with the panel hidden. Other sources:
 * the cover, when the mini player is on. Click: play / pause.
 */
function Stage() {
  const now = usePlayer((s) => s.now)!
  const playing = usePlayer((s) => s.playing)
  const toggle = usePlayer((s) => s.toggle)
  const track = useNowTrack()
  return (
    <section aria-label={tr('Mini player')} onContextMenu={onMenu(playerMenu)} className={`shrink-0 ${LOOK}`}>
      {now.via === 'youtube' ? (
        <VideoSlot fill onClick={toggle} className="h-50 w-full" />
      ) : (
        <button onClick={toggle} title={playing ? tr('Pause') : tr('Play')} className="block">
          <Cover title={now.title} art={track ? trackArt(track) : undefined} size={276} />
        </button>
      )}
    </section>
  )
}

/**
 * Right panel of the main window (docs/design.md): Up next or the lyrics of what plays, beside every page (setting
 * sidePanel; Now Playing keeps its own panels). Tabs on top switch between them, as in the mockups.
 */
export function SidePanel() {
  const now = usePlayer((s) => s.now)
  const full = usePlayer((s) => s.full)
  const panel = useSettings((s) => s.settings.sidePanel)
  const here = useSettings((s) => s.settings.miniPlace === 'panel')
  const on = useSettings((s) => s.settings.miniPlayer)
  const update = useSettings((s) => s.update)
  if (!now) return null
  // Not under Now Playing: its own video slot takes the video.
  const stage = here && !full && (now.via === 'youtube' || on)
  if (!stage && panel === 'none') return null
  const tabs = (
    <span role="tablist" aria-label={tr('Show')} className="flex flex-wrap gap-1.5">
      <LedChip on={panel === 'upNext'} label={tr('Up next')} onClick={() => update({ sidePanel: 'upNext' })} />
      <LedChip on={panel === 'lyrics'} label={tr('Lyrics')} onClick={() => update({ sidePanel: 'lyrics' })} />
    </span>
  )
  const look = `min-h-0 flex-1 ${LOOK}`
  return (
    <div className="flex w-75 shrink-0 flex-col gap-2">
      {stage && <Stage />}
      {panel === 'lyrics' && <LyricsPanel heading={tabs} onHide={() => update({ sidePanel: 'none' })} onUpNext={() => update({ sidePanel: 'upNext' })} className={look} />}
      {panel === 'upNext' && <UpNext heading={tabs} onHide={() => update({ sidePanel: 'none' })} className={look} />}
    </div>
  )
}
