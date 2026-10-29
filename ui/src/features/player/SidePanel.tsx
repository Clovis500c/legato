import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { EditorPanel } from '../editor/EditorPanel'
import { LyricsPanel } from './LyricsPanel'
import { usePlayer } from './store'
import { UpNext } from './UpNext'

const LOOK = 'shrink-0 rounded-lg bg-panel p-3'

/**
 * Right panel of the main window (docs/design.md): Up next, lyrics or the Live Editor of what plays, beside every page.
 * Same switches as Now Playing's panels (settings upNext, lyrics, editor), so one panel follows you between both.
 */
export function SidePanel() {
  const playing = usePlayer((s) => !!s.now)
  const { upNext, lyrics, editor } = useSettings(useShallow((s) => ({ upNext: s.settings.upNext, lyrics: s.settings.lyrics, editor: s.settings.editor })))
  const update = useSettings((s) => s.update)
  if (!playing) return null
  if (editor) return <EditorPanel onHide={() => update({ editor: false })} className={`w-100 ${LOOK}`} />
  if (lyrics) return <LyricsPanel onHide={() => update({ lyrics: false })} onUpNext={() => update({ lyrics: false, upNext: true })} className={`w-75 ${LOOK}`} />
  return upNext ? <UpNext onHide={() => update({ upNext: false })} className={`w-75 ${LOOK}`} /> : null
}
