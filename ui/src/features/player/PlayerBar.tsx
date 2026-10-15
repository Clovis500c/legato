import { getCurrentWebview } from '@tauri-apps/api/webview'
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useEffect } from 'react'
import { api } from '../../shared/api'
import { coverGradient, formatDuration } from '../../shared/format'
import { bindFrame, usePlayer } from './store'
import { embedUrl, parseYt, ytPost } from './youtube'

const AUDIO = /\.(mp3|flac|wav|ogg|m4a|aac)$/i
const time = (ms: number | null) => formatDuration(ms) || '0:00'

/** Range input styled as Figma bar: filled part = `fill` background. */
function Bar({ label, value, max, onChange, fill, className = '' }: { label: string; value: number; max: number; onChange: (v: number) => void; fill: string; className?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max || 1}
      step="any"
      value={Math.min(value, max)}
      disabled={!max}
      onChange={(e) => onChange(+e.target.value)}
      className={`bar h-1 ${className}`}
      style={{ background: `${fill} 0 / ${pct}% 100% no-repeat, #2a2a35` }}
    />
  )
}

/** YouTube rules: player stays visible, min 200×200 viewport. */
function YouTubeFrame({ videoId }: { videoId: string }) {
  const onYoutube = usePlayer((s) => s.onYoutube)
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
      className="fixed right-5 bottom-25 z-10 h-50 w-89 rounded-xl border border-line bg-black shadow-2xl"
    />
  )
}

export function PlayerBar() {
  const { now, playing, positionMs, durationMs, volume, playFiles, toggle, seek, step, setVolume, onLocal } = usePlayer()
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
    <footer className="flex h-22 shrink-0 items-center justify-between gap-6 border-t border-line-soft bg-panel px-5">
      {now?.youtubeId && <YouTubeFrame videoId={now.youtubeId} />}

      <div className="flex w-80 min-w-0 items-center gap-3">
        <span className="size-13 shrink-0 rounded-lg" style={{ background: now ? coverGradient(now.title) : 'var(--color-surface)' }} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{now?.title ?? 'Rien en lecture'}</span>
          <span className="truncate text-xs text-muted">{now?.artist ?? 'Lance un titre YouTube ou glisse des fichiers audio ici'}</span>
        </div>
      </div>

      <div className="flex w-145 min-w-0 flex-col items-center gap-2">
        <div className="flex items-center gap-5.5">
          <button aria-label="Précédent" disabled={!now} onClick={() => step(-1)} className="disabled:opacity-40">
            <SkipBack size={20} strokeWidth={1.67} />
          </button>
          <button
            aria-label={playing ? 'Pause' : 'Lecture'}
            disabled={!now}
            onClick={toggle}
            className="grid size-10 place-items-center rounded-full bg-fg text-bg transition hover:scale-105 disabled:opacity-40"
          >
            {playing ? <Pause size={18} strokeWidth={1.5} /> : <Play size={18} strokeWidth={1.5} />}
          </button>
          <button aria-label="Suivant" disabled={!now} onClick={() => step(1)} className="disabled:opacity-40">
            <SkipForward size={20} strokeWidth={1.67} />
          </button>
        </div>
        <div className="flex w-full items-center gap-2.5 text-[11px] text-muted tabular-nums">
          <span>{time(positionMs)}</span>
          <Bar label="Position" value={positionMs} max={durationMs ?? 0} onChange={seek} fill="linear-gradient(90deg, var(--color-accent-from), var(--color-accent-to))" className="flex-1" />
          <span>{time(durationMs)}</span>
        </div>
      </div>

      <div className="flex w-80 items-center justify-end gap-2 text-muted">
        <Volume2 size={17} strokeWidth={1.42} />
        <Bar label="Volume" value={volume} max={1} onChange={setVolume} fill="linear-gradient(var(--color-fg), var(--color-fg))" className="w-25" />
      </div>
    </footer>
  )
}
