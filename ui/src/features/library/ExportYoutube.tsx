import { ArrowSquareOut, UploadSimple } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useCallback, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ExportReport } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { RoundButton, Stat } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'

/** Playlist → private YouTube playlist. Run again later: same YouTube playlist, only what's missing is added. */
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
      <RoundButton label={connected ? 'Export to YouTube' : 'Connect YouTube to export'} disabled={!connected || state === 'busy'} onClick={run}>
        <UploadSimple size={16} />
      </RoundButton>
      {state !== 'idle' && (
        <Dialog title={state === 'busy' ? 'Exporting to YouTube…' : 'Exported to YouTube'} kicker="Private playlist on your channel" onClose={close}>
          {state === 'busy' ? (
            <p className="text-xs text-ink-2">A few tracks a second. A free YouTube key allows about 190 additions a day; the rest goes in on the next export.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <Stat label="Added" value={state.added} />
                <Stat label="Already there" value={state.already} />
                <Stat label="Left for tomorrow" value={state.remaining} />
              </div>
              {(state.noYoutube > 0 || state.unavailable > 0) && (
                <p className="text-xs text-ink-2">
                  {state.noYoutube > 0 && `${state.noYoutube} without a YouTube version: use “Find full versions”, then export again. `}
                  {state.unavailable > 0 && `${state.unavailable} videos no longer exist on YouTube.`}
                </p>
              )}
              {state.remaining > 0 && <p className="text-xs text-ink-2">Today’s YouTube quota is used up. Export again tomorrow to add the rest.</p>}
              <div className="flex justify-end">
                <Button onClick={() => openUrl(state.url)}>
                  Open on YouTube <ArrowSquareOut size={14} />
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}
