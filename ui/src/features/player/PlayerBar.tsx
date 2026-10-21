import { ArrowsOutSimple, SpeakerHigh, SpeakerLow, SpeakerSlash } from '@phosphor-icons/react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Source } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { Bar, Knob, RoundButton } from '../../shared/ui/controls'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { SeekBar, TimeText } from './Progress'
import { Transport } from './Transport'
import { onMenu } from '../../shared/ui/ContextMenu'
import { playerMenu } from '../menus'
import { trackArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { bindFrame, useNowTrack, usePlayer, useVideoSlot } from './store'
import { embedUrl, parseYt, ytPost } from './youtube'
import { closeWatch, cropWatch, placeWatch, useWatch, watchUpdate } from './watch'
import { frameAround } from '../../shared/artbox'
import { bindLiveFrame, sendLive } from './live'
import { useLiveSync } from './liveSync'
import { AdaptiveBar } from './AdaptiveBar'
import { tr } from '../../shared/i18n/i18n'

const AUDIO = /\.(mp3|flac|wav|ogg|m4a|aac)$/i
export const clock = (ms: number | null) => formatDuration(ms) || '0:00'
export const fileFormat = (path?: string) => path?.split('.').pop()?.toUpperCase()

// Source of what plays: icon only, details in its tooltip. Previews come from Apple Music.
const viaSource: Record<string, Source> = { local: 'local', youtube: 'youtube', spotify: 'spotify', preview: 'apple' }
function viaTitle(via: string, path?: string) {
  if (via === 'local') return tr('Playing a local file') + (path ? ` · ${fileFormat(path)}` : '')
  if (via === 'preview') return tr('Playing a 30-second Apple Music preview')
  return tr('Playing from {source}', { source: via === 'youtube' ? 'YouTube' : 'Spotify' })
}

/**
 * YouTube rules: player stays visible, min 200×200. Follows the Now Playing slot when open. One embed for a whole run
 * of YouTube tracks: the next video is loaded into the player already running (loadVideoById), no page reload, so
 * songs follow each other without the embed's loading time.
 */
function YouTubeFrame({ videoId }: { videoId: string }) {
  const onYoutube = usePlayer((s) => s.onYoutube)
  const rect = useVideoSlot((s) => s.rect)
  const hidden = useVideoSlot((s) => s.hidden)
  const box = useVideoSlot((s) => s.box)
  // Embed refused this video: YouTube's watch page plays it in a webview over the same place (watch.ts).
  const watch = useWatch((s) => s.video)
  // Bars baked into the video: frame enlarged, only the picture shows.
  const crop = rect && box && !hidden && !watch ? frameAround(rect, box) : null
  const frame = useRef<HTMLIFrameElement | null>(null)
  const ready = useRef(false)
  // First video and options at mount: changing src later would reload the embed.
  // hold = restored paused (after an update): cued, not playing.
  const [src] = useState(() => ({ first: videoId, controls: useSettings.getState().settings.youtubeControls, start: usePlayer.getState().startAt / 1000, autoplay: !usePlayer.getState().hold }))
  const shown = useRef(videoId)
  const captionsOff = useRef<string | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const u = parseYt(e.origin, e.data)
      if (!u) return
      // Subtitles off (default): YouTube may turn them on from the Google account, unload them once per video.
      if (u.state === 1 && captionsOff.current !== shown.current && !useSettings.getState().settings.subtitles) {
        captionsOff.current = shown.current
        for (const m of ['captions', 'cc']) ytPost(frame.current, 'command', 'unloadModule', [m])
      }
      onYoutube(u)
    }
    window.addEventListener('message', onMessage)
    // Watch page reports: same updates; a click on it is our play / pause.
    const off = api.onYtWatch((r) => {
      const v = useWatch.getState().video
      if (!v) return
      if (r.click) return usePlayer.getState().toggle()
      // Fresh page: commands sent while it loaded were lost. Volume (it stays muted until then) and crop again.
      if (r.ready) {
        usePlayer.getState().applyVolume(true)
        sendLive()
      }
      const box = useVideoSlot.getState().box
      if (box && !r.cropped && !useVideoSlot.getState().hidden) cropWatch(box)
      const u = watchUpdate(r, v)
      if (u) onYoutube(u)
    })
    return () => {
      window.removeEventListener('message', onMessage)
      void off.then((f) => f())
    }
  }, [onYoutube])
  // Watch page follows the slot (or this frame's own spot), hidden in cover mode. Gone with the last YouTube track.
  useEffect(() => {
    if (!watch) return
    const follow = () => placeWatch(hidden ? null : (rect ?? frame.current?.getBoundingClientRect() ?? null))
    follow()
    window.addEventListener('resize', follow)
    return () => window.removeEventListener('resize', follow)
  }, [watch, rect, hidden])
  useEffect(() => {
    if (watch && box) cropWatch(box)
  }, [watch, box])
  useEffect(() => () => closeWatch(), [])
  // Next video: into the running player. Not loaded yet: onLoad sends it.
  useEffect(() => {
    if (shown.current === videoId || !ready.current) return
    shown.current = videoId
    ytPost(frame.current, 'command', 'loadVideoById', [videoId, usePlayer.getState().startAt / 1000])
  }, [videoId])

  return (
    <iframe
      ref={(el) => {
        frame.current = el
        bindFrame(el)
        bindLiveFrame(el)
      }}
      title={tr('YouTube player')}
      src={embedUrl(src.first, location.origin, src)}
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={(e) => {
        ready.current = true
        ytPost(e.currentTarget, 'listening')
        // Skipped ahead while the embed loaded: catch up.
        if (shown.current !== videoId) {
          shown.current = videoId
          ytPost(e.currentTarget, 'command', 'loadVideoById', [videoId, usePlayer.getState().startAt / 1000])
        }
        usePlayer.getState().applyVolume(true)
        sendLive()
      }}
      // Hidden (cover shown instead): YouTube's minimum size, so it streams a low resolution nobody sees.
      style={crop ?? (rect ? { left: rect.left, top: rect.top, width: hidden ? 200 : rect.width, height: hidden ? 200 : rect.height } : undefined)}
      // Bare video: no pointer on it, so YouTube's hover overlay never shows; our controls drive it.
      className={`fixed z-30 bg-black ${crop ? '' : 'rounded-lg border border-line'} ${src.controls && !hidden && !watch ? '' : 'pointer-events-none'} ${hidden || watch ? 'opacity-0' : ''} ${rect ? '' : 'right-6 bottom-[112px] h-50 w-89 shadow-[0_12px_32px_var(--shadow)]'}`}
    />
  )
}

// Volume before mute, restored by unmute.
let unmuted = 1

/** Knob, or YouTube-like speaker (click = mute) and bar. */
export function VolumeControl({ big }: { big?: boolean }) {
  const volume = usePlayer((s) => s.volume)
  const setVolume = usePlayer((s) => s.setVolume)
  const mode = useSettings((s) => s.settings.volume)
  if (mode === 'knob')
    return (
      <span className="flex items-center gap-1.5 text-ink-3">
        {!big && <SpeakerHigh size={15} />}
        <span className="flex flex-col items-center gap-1">
          <Knob value={volume} onChange={setVolume} size={big ? 50 : 30} ticks={big} />
          <AdaptiveBar className="w-full" />
        </span>
      </span>
    )
  const Icon = volume === 0 ? SpeakerSlash : volume < 0.5 ? SpeakerLow : SpeakerHigh
  const mute = () => {
    if (volume > 0) unmuted = volume
    setVolume(volume > 0 ? 0 : unmuted || 1)
  }
  return (
    <span className="flex items-center gap-1">
      <RoundButton label={volume > 0 ? tr('Mute') : tr('Unmute')} kind="plain" size={big ? 'md' : 'sm'} onClick={mute}>
        <Icon size={big ? 20 : 16} />
      </RoundButton>
      <span className="relative flex items-center">
        <Bar label={tr('Volume')} value={volume} max={1} onChange={setVolume} className={big ? 'w-32' : 'w-24'} />
        <AdaptiveBar className="absolute inset-x-0 -bottom-1.5" />
      </span>
    </span>
  )
}

export function PlayerBar() {
  const now = usePlayer((s) => s.now)
  const playFiles = usePlayer((s) => s.playFiles)
  const onLocal = usePlayer((s) => s.onLocal)
  const onSpotify = usePlayer((s) => s.onSpotify)
  const setFull = usePlayer((s) => s.setFull)
  const readout = useSettings((s) => s.settings.readout)
  const track = useNowTrack()
  useLiveSync()
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
    <footer onContextMenu={onMenu(playerMenu)} className="flex h-25 shrink-0 items-center justify-between gap-6 border-t border-line bg-panel px-6 py-2">
      {now?.youtubeId && <YouTubeFrame videoId={now.youtubeId} />}

      <button disabled={!now} onClick={() => setFull(true)} title={now ? tr('Open Now Playing') : undefined} className="flex w-85 min-w-0 items-center gap-3.5 text-left">
        <Cover title={now?.title ?? ''} art={track && trackArt(track)} size={56} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold">{now?.title ?? tr('Nothing playing')}</span>
          <span className="truncate text-xs text-ink-2">{now?.artist ?? tr('Play a YouTube track or drop audio files here')}</span>
        </span>
      </button>

      <div className="flex w-140 min-w-0 flex-col items-center gap-2.5">
        <Transport />
        <div className="flex w-full items-center gap-3 font-mono text-[10px] text-ink-3">
          <TimeText part="elapsed" />
          <SeekBar className="flex-1" />
          <TimeText part="remaining" />
        </div>
      </div>

      <div className="flex w-85 items-center justify-end gap-3.5">
        {readout && now && (
          <span title={viaTitle(now.via, now.path)} className="grid size-8 shrink-0 place-items-center text-ink-2">
            <SourceIcon source={viaSource[now.via]} size={17} />
          </span>
        )}
        <VolumeControl />
        <RoundButton label={tr('Now playing, full screen')} disabled={!now} onClick={() => setFull(true)}>
          <ArrowsOutSimple size={15} />
        </RoundButton>
      </div>
    </footer>
  )
}
