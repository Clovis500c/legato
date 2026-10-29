import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { LedChip } from '../../shared/ui/controls'
import { LyricsPanel } from './LyricsPanel'
import { usePlayer } from './store'
import { UpNext } from './UpNext'

const LOOK = 'shrink-0 rounded-lg bg-panel p-3'

/**
 * Right panel of the main window (docs/design.md): Up next or the lyrics of what plays, beside every page (setting
 * sidePanel; Now Playing keeps its own panels). Tabs on top switch between them, as in the mockups.
 */
export function SidePanel() {
  const playing = usePlayer((s) => !!s.now)
  const panel = useSettings((s) => s.settings.sidePanel)
  const update = useSettings((s) => s.update)
  if (!playing || panel === 'none') return null
  const tabs = (
    <span role="tablist" aria-label={tr('Show')} className="flex flex-wrap gap-1.5">
      <LedChip on={panel === 'upNext'} label={tr('Up next')} onClick={() => update({ sidePanel: 'upNext' })} />
      <LedChip on={panel === 'lyrics'} label={tr('Lyrics')} onClick={() => update({ sidePanel: 'lyrics' })} />
    </span>
  )
  if (panel === 'lyrics') return <LyricsPanel heading={tabs} onHide={() => update({ sidePanel: 'none' })} onUpNext={() => update({ sidePanel: 'upNext' })} className={`w-75 ${LOOK}`} />
  return <UpNext heading={tabs} onHide={() => update({ sidePanel: 'none' })} className={`w-75 ${LOOK}`} />
}
