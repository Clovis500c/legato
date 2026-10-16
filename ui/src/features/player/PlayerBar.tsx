import { ArrowsOutSimple, SpeakerHigh } from '@phosphor-icons/react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { Bar, Knob, Readout, RoundButton } from '../../shared/ui/controls'
import { Transport } from './Transport'
import { onMenu } from '../../shared/ui/ContextMenu'
import { playerMenu } from '../menus'
import { trackArt } from '../../shared/art'
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
      title="YouTube player"
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
  const { now, positionMs, durationMs, playFiles, seek, onLocal, onSpotify, setFull } = usePlayer()
  const readout = useSettings((s) => s.settings.readout)
  const track = useStore((s) => s.tracks.find((t) => t.id === now?.trackId))
  // Engine plays local files and previews: poll it. Spotify Connect: poll its API, slower (rate limits).
  const local = now && (now.via === 'local' || now.via === 'preview')
  const remote = now?.via === 'spotify'

  // Drop audio files on window = play them as a queue. Drop an image = read a shared playlist QR code.
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== 'drop') return
      const files = e.payload.paths.filter((p) => AUDIO.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      const image = e.payload.paths.find((p) => /\.(png|jpe?g)$/i.test(p))
      if (files.length) playFiles(files)
      else if (image)
        api
          .shareReadImage(image)
          .then((incoming) => useStore.setState({ incoming }))
          .catch((err) => useStore.setState({ error: String(err) }))
    })
    return () => void off.then((f) => f())
  }, [playFiles])

  // shortcut: polls engine at 4 Hz. Switch to Tauri events if it shows in profiles.
  useEffect(() => {
    if (!local) return
    const id = setInterval(() => api.playerStatus().then(onLocal), 250)
    return () => clearInterval(id)
  }, [local, onLocal])

  useEffect(() => {
    if (!remote) return
    const id = setInterval(
      () =>
        api
          .spotifyPlayback()
          .then(onSpotify)
          .catch((e) => useStore.setState({ error: String(e) })),
      1500,
    )
    return () => clearInterval(id)
  }, [remote, onSpotify])

  return (
    <footer onContextMenu={onMenu(playerMenu)} className="flex h-23 shrink-0 items-center justify-between gap-6 border-t border-line bg-panel px-6">
      {now?.youtubeId && <YouTubeFrame videoId={now.youtubeId} />}

      <button disabled={!now} onClick={() => setFull(true)} title={now ? 'Open Now Playing' : undefined} className="flex w-85 min-w-0 items-center gap-3.5 text-left">
        <Cover title={now?.title ?? ''} art={track && trackArt(track)} size={56} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold">{now?.title ?? 'Nothing playing'}</span>
          <span className="truncate text-xs text-ink-2">{now?.artist ?? 'Play a YouTube track or drop audio files here'}</span>
        </span>
      </button>

      <div className="flex w-140 min-w-0 flex-col items-center gap-2">
        <Transport />
        <div className="flex w-full items-center gap-3 font-mono text-[10px] text-ink-3 tabular-nums">
          <span>{clock(positionMs)}</span>
          <Bar label="Position" value={positionMs} max={durationMs ?? 0} onChange={seek} className="flex-1" />
          <span>-{clock(Math.max(0, (durationMs ?? 0) - positionMs))}</span>
        </div>
      </div>

      <div className="flex w-85 items-center justify-end gap-3.5">
        {readout && now && <Readout detail={now.via === 'local' ? fileFormat(now.path) : now.via === 'preview' ? '30 S' : undefined}>{{ local: 'Local', youtube: 'YouTube', spotify: 'Spotify', preview: 'Preview' }[now.via]}</Readout>}
        <span className="flex items-center gap-1.5 text-ink-3">
          <SpeakerHigh size={15} />
          <VolumeControl />
        </span>
        <RoundButton label="Now playing, full screen" disabled={!now} onClick={() => setFull(true)}>
          <ArrowsOutSimple size={15} />
        </RoundButton>
      </div>
    </footer>
  )
}
