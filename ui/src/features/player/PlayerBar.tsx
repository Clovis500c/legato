import { ArrowsOutSimple, Pause, Play, SkipBack, SkipForward, SpeakerHigh } from '@phosphor-icons/react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect } from 'react'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { Bar, Knob, Readout, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { bindFrame, usePlayer, useVideoSlot } from './store'
import { embedUrl, parseYt, ytPost } from './youtube'

const AUDIO = /\.(mp3|flac|wav|ogg|m4a|aac)$/i
export const clock = (ms: number | null) => formatDuration(ms) || '0:00'
export const fileFormat = (path?: string) => path?.split('.').pop()?.toUpperCase()

/** YouTube rules: player stays visible, min 200×200. Follows the Now Playing slot when open. */
function YouTubeFrame({ videoId }: { videoId: string }) {
  const onYoutube = usePlayer((s) => s.onYoutube)
  const rect = useVideoSlot((s) => s.rect)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const u = parseYt(e.origin, e.data)
      if (u) onYoutube(u)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onYoutube])

  return (
    <iframe
      key={videoId}
      ref={bindFrame}
      title="Lecteur YouTube"
      src={embedUrl(videoId, location.origin)}
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={(e) => {
        ytPost(e.currentTarget, 'listening')
        usePlayer.getState().setVolume(usePlayer.getState().volume)
      }}
      style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined}
      className={`fixed z-30 rounded-lg border border-line bg-black ${rect ? '' : 'right-6 bottom-[104px] h-50 w-89 shadow-[0_12px_32px_var(--shadow)]'}`}
    />
  )
}

export function VolumeControl({ big }: { big?: boolean }) {
  const { volume, setVolume } = usePlayer()
  const mode = useSettings((s) => s.settings.volume)
  return mode === 'knob' ? <Knob value={volume} onChange={setVolume} size={big ? 50 : 30} ticks={big} /> : <Bar label="Volume" value={volume} max={1} onChange={setVolume} className={big ? 'w-36' : 'w-24'} />
}

export function PlayerBar() {
  const { now, playing, positionMs, durationMs, playFiles, toggle, seek, step, onLocal, setFull } = usePlayer()
  const readout = useSettings((s) => s.settings.readout)
  const local = now && !now.youtubeId

  // Drop audio files on window = play them as a queue.
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== 'drop') return
      const files = e.payload.paths.filter((p) => AUDIO.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      if (files.length) playFiles(files)
    })
    return () => void off.then((f) => f())
  }, [playFiles])

  // shortcut: polls engine at 4 Hz. Switch to Tauri events if it shows in profiles.
  useEffect(() => {
    if (!local) return
    const id = setInterval(() => api.playerStatus().then(onLocal), 250)
    return () => clearInterval(id)
  }, [local, onLocal])

  return (
    <footer className="flex h-23 shrink-0 items-center justify-between gap-6 border-t border-line bg-panel px-6">
      {now?.youtubeId && <YouTubeFrame videoId={now.youtubeId} />}

      <div className="flex w-85 min-w-0 items-center gap-3.5">
        <Cover title={now?.title ?? ''} size={56} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold">{now?.title ?? 'Rien en lecture'}</span>
          <span className="truncate text-xs text-ink-2">{now?.artist ?? 'Lance un titre YouTube ou glisse des fichiers audio ici'}</span>
        </div>
      </div>

      <div className="flex w-140 min-w-0 flex-col items-center gap-2">
        <div className="flex items-center gap-3.5">
          <RoundButton label="Précédent" disabled={!now} onClick={() => step(-1)}>
            <SkipBack weight="fill" size={15} />
          </RoundButton>
          <RoundButton label={playing ? 'Pause' : 'Lecture'} kind="primary" size="lg" disabled={!now} onClick={toggle}>
            {playing ? <Pause weight="fill" size={20} /> : <Play weight="fill" size={20} />}
          </RoundButton>
          <RoundButton label="Suivant" disabled={!now} onClick={() => step(1)}>
            <SkipForward weight="fill" size={15} />
          </RoundButton>
        </div>
        <div className="flex w-full items-center gap-3 font-mono text-[10px] text-ink-3 tabular-nums">
          <span>{clock(positionMs)}</span>
          <Bar label="Position" value={positionMs} max={durationMs ?? 0} onChange={seek} className="flex-1" />
          <span>-{clock(Math.max(0, (durationMs ?? 0) - positionMs))}</span>
        </div>
      </div>

      <div className="flex w-85 items-center justify-end gap-3.5">
        {readout && now && <Readout detail={local ? fileFormat(now.path) : undefined}>{local ? 'Local' : 'YouTube'}</Readout>}
        <span className="flex items-center gap-1.5 text-ink-3">
          <SpeakerHigh size={15} />
          <VolumeControl />
        </span>
        <RoundButton label="En lecture, plein écran" disabled={!now} onClick={() => setFull(true)}>
          <ArrowsOutSimple size={15} />
        </RoundButton>
      </div>
    </footer>
  )
}
