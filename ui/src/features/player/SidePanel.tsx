import { useSettings } from '../../app/settings'
import { LyricsPanel } from './LyricsPanel'
import { usePlayer } from './store'
import { UpNext } from './UpNext'

const LOOK = 'shrink-0 rounded-lg bg-panel p-3'

/**
 * Right panel of the main window (docs/design.md): Up next or the lyrics of what plays, beside every page (setting
 * sidePanel; Now Playing keeps its own panels).
 */
export function SidePanel() {
  const playing = usePlayer((s) => !!s.now)
  const panel = useSettings((s) => s.settings.sidePanel)
  const update = useSettings((s) => s.update)
  if (!playing || panel === 'none') return null
  if (panel === 'lyrics') return <LyricsPanel onHide={() => update({ sidePanel: 'none' })} onUpNext={() => update({ sidePanel: 'upNext' })} className={`w-75 ${LOOK}`} />
  return <UpNext onHide={() => update({ sidePanel: 'none' })} className={`w-75 ${LOOK}`} />
}
