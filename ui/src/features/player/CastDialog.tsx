import { useEffect, useState } from 'react'
import { api, type CastDevice } from '../../shared/api'
import { explain } from '../../shared/errors'
import { tr } from '../../shared/i18n/i18n'
import { Dialog } from '../../shared/ui/Dialog'
import { positionNow } from './Progress'
import { useNowTrack, usePlayer } from './store'

/** Settings › Playback › Cast to speakers: the speakers and TVs on this network, one click to play the song on one. */
export function CastDialog({ onClose }: { onClose: () => void }) {
  const track = useNowTrack()
  const now = usePlayer((s) => s.now)
  const [devices, setDevices] = useState<CastDevice[] | null>(null)
  const [on, setOn] = useState<CastDevice | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api.castScan().then(
      (d) => live && setDevices(d),
      (e) => live && (setDevices([]), setError(explain(e).text)),
    )
    return () => {
      live = false
    }
  }, [])
  const castable = now?.via === 'local' && !!track
  const start = (d: CastDevice) => {
    if (!track) return
    setError('')
    api.castPlay(d.id, track.id, `${track.title} - ${track.artist}`, Math.round(positionNow())).then(
      () => {
        setOn(d)
        // The song plays over there now: not here too.
        if (usePlayer.getState().playing) usePlayer.getState().pauseNow()
      },
      (e) => setError(explain(e).text),
    )
  }
  const control = (action: 'pause' | 'play' | 'stop') => {
    if (!on) return
    api.castControl(on.id, action, 0).then(
      () => action === 'stop' && setOn(null),
      (e) => setError(explain(e).text),
    )
  }
  const button = 'rounded-full border border-line px-3 py-1 text-sm hover:text-ink'
  return (
    <Dialog title={tr('Cast to speakers')} onClose={onClose}>
      {on && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{tr('Playing on {name}', { name: on.name })}</span>
          <button onClick={() => control('pause')} className={button}>
            {tr('Pause')}
          </button>
          <button onClick={() => control('play')} className={button}>
            {tr('Play')}
          </button>
          <button onClick={() => control('stop')} className={button}>
            {tr('Stop casting')}
          </button>
        </div>
      )}
      {!castable && !on && <p className="text-sm text-ink-2">{tr('Only a song from your own files can be cast.')}</p>}
      {devices === null && <p className="text-sm text-ink-2">{tr('Looking for speakers on this network…')}</p>}
      {devices?.length === 0 && !error && <p className="text-sm text-ink-2">{tr('No speaker found on this network')}</p>}
      <div className="flex flex-col gap-1">
        {devices?.map((d) => (
          <button key={d.id} disabled={!castable} onClick={() => start(d)} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-raised disabled:opacity-50">
            {d.name}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-ink-2">{error}</p>}
    </Dialog>
  )
}
