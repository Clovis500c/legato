import { ArrowSquareOut, UploadSimple } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useCallback, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ExportReport } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { RoundButton, Stat } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { tr } from '../../shared/i18n/i18n'

/** Playlist → private YouTube Music playlist (first synced account). Run again later: same playlist, only what's missing is added. */
export function ExportYoutube({ id }: { id: number }) {
  const connected = useStore((s) => s.status.youtube.connected)
  const [state, setState] = useState<'idle' | 'busy' | ExportReport>('idle')
  const close = useCallback(() => setState('idle'), [])
  const run = async () => {
    setState('busy')
    try {
      setState(await api.exportYoutube(id))
    } catch (e) {
      useStore.setState({ error: String(e) })
      setState('idle')
    }
  }
  return (
    <>
      <RoundButton label={connected ? tr('Export to YouTube Music') : tr('Sign in to YouTube Music to export')} disabled={!connected || state === 'busy'} onClick={run}>
        <UploadSimple size={16} />
      </RoundButton>
      {state !== 'idle' && (
        <Dialog title={state === 'busy' ? tr('Exporting to YouTube Music…') : tr('Exported to YouTube Music')} kicker={tr('Private playlist on your account')} onClose={close}>
          {state === 'busy' ? (
            <p className="text-xs text-ink-2">{tr('A few seconds.')}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <Stat label={tr('Added')} value={state.added} />
                <Stat label={tr('Already there')} value={state.already} />
                <Stat label={tr('No YouTube version')} value={state.noYoutube} />
              </div>
              {state.noYoutube > 0 && <p className="text-xs text-ink-2">{tr('Use “Find full versions” on this playlist, then export again to add them.')}</p>}
              <div className="flex justify-end">
                <Button onClick={() => openUrl(state.url)}>
                  {tr('Open on YouTube Music')} <ArrowSquareOut size={14} />
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}
