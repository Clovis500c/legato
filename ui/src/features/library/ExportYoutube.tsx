import { ArrowSquareOut, UploadSimple } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useCallback, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ExportReport } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { RoundButton, Stat } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'

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
      <RoundButton label={connected ? 'Export to YouTube Music' : 'Sign in to YouTube Music to export'} disabled={!connected || state === 'busy'} onClick={run}>
        <UploadSimple size={16} />
      </RoundButton>
      {state !== 'idle' && (
        <Dialog title={state === 'busy' ? 'Exporting to YouTube Music…' : 'Exported to YouTube Music'} kicker="Private playlist on your account" onClose={close}>
          {state === 'busy' ? (
            <p className="text-xs text-ink-2">A few seconds.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <Stat label="Added" value={state.added} />
                <Stat label="Already there" value={state.already} />
                <Stat label="No YouTube version" value={state.noYoutube} />
              </div>
              {state.noYoutube > 0 && <p className="text-xs text-ink-2">Use “Find full versions” on this playlist, then export again to add them.</p>}
              <div className="flex justify-end">
                <Button onClick={() => openUrl(state.url)}>
                  Open on YouTube Music <ArrowSquareOut size={14} />
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}
