import { ArrowsOutSimple, Heart, Moon, Queue, Quotes, SpeakerHigh, SpeakerLow, SpeakerSlash } from '@phosphor-icons/react'
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
import { onMenu, openMenu } from '../../shared/ui/ContextMenu'
import { sleepLabel, sleepMenu, useSleep } from './sleep'
import { playerMenu } from '../menus'
import { trackArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { ArtistLink } from './ArtistLink'
import { bindFrame, useNowTrack, usePlayer, useVideoSlot } from './store'
import { embedUrl, parseYt, ytPost } from './youtube'
import { fadeGain } from './fade'
import { songEnd } from './ends'
import { closeWatch, cropWatch, placeWatch, sendWatch, useWatch, watchUpdate } from './watch'
import { frameAround } from '../../shared/artbox'
import { bindLiveFrame, sendLive } from './live'
import { useLiveSync } from './liveSync'
import { AdaptiveBar } from './AdaptiveBar'
import { toggleLike, useLiked } from './like'
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
 * songs follow each other without the embed's loading time. Overlapping songs: tail = the old embed, unseen, fading out
 * on its own until its video ends; idle = stopped there, waiting to take the next overlap's song.
 */
function YouTubeFrame({ videoId, tail = false, idle = false }: { videoId: string; tail?: boolean; idle?: boolean }) {
  const onYoutube = usePlayer((s) => s.onYoutube)
  const rect = useVideoSlot((s) => s.rect)
  const hidden = useVideoSlot((s) => s.hidden)
  const box = useVideoSlot((s) => s.box)
  const fill = useVideoSlot((s) => s.fill)
  // Embed refused this video: YouTube's watch page plays it in a webview over the same place (watch.ts).
  const watch = useWatch((s) => s.video)
  // Bars baked into the video: frame enlarged, only the picture shows.
  const crop = rect && (box || fill) && !hidden && !watch ? frameAround(rect, box ?? { x: 0, y: 0, w: 1, h: 1 }) : null
  const frame = useRef<HTMLIFrameElement | null>(null)
  const ready = useRef(false)
  // First video and options at mount: changing src later would reload the embed.
  // hold = restored paused (after an update): cued, not playing.
  const [src] = useState(() => ({ first: videoId, controls: useSettings.getState().settings.youtubeControls, start: usePlayer.getState().startAt / 1000, autoplay: !usePlayer.getState().hold }))
  const shown = useRef(videoId)
  const captionsOff = useRef<string | null>(null)
  const isTail = useRef(tail)
  isTail.current = tail
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Two embeds while songs overlap: each reads its own.
      const u = e.source === frame.current?.contentWindow ? parseYt(e.origin, e.data) : undefined
      if (!u) return
      if (isTail.current) {
        const { tail: t, volume, fade, earlyEnds } = usePlayer.getState()
        if (!t || t.done) return
        // Fades out to its song's own end (learned early end), then only silence is left: stopped too.
        const end = u.duration ? (earlyEnds ? songEnd(t.videoId, u.duration * 1000) : u.duration * 1000) : 0
        if (u.state === 0 || u.error !== undefined || (end && u.time !== undefined && u.time * 1000 >= end)) return usePlayer.setState({ tail: { ...t, done: true } })
        if (u.time !== undefined && end) ytPost(frame.current, 'command', 'setVolume', [Math.round(volume * fadeGain(u.time * 1000, end, fade, false) * 100)])
        return
      }
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
      if (!v || isTail.current) return
      if (r.click) return usePlayer.getState().toggle()
      // Fresh page: commands sent while it loaded were lost. Volume (it stays muted until then) and crop again.
      if (r.ready) {
        usePlayer.getState().applyVolume(true)
        // Commands sent before the page's script ran are lost: paused in the app = paused there too.
        if (!usePlayer.getState().playing) sendWatch('pauseVideo', [])
        sendLive(undefined, true)
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
    if (!watch || tail) return
    const follow = () => placeWatch(hidden ? null : (rect ?? frame.current?.getBoundingClientRect() ?? null))
    follow()
    window.addEventListener('resize', follow)
    return () => window.removeEventListener('resize', follow)
  }, [watch, rect, hidden, tail])
  useEffect(() => {
    if (watch && box && !tail) cropWatch(box)
  }, [watch, box, tail])
  useEffect(
    () => () => {
      if (!isTail.current) closeWatch()
    },
    [],
  )
  // Song over or cut short: stopped (frees its video), the embed stays. Taken back, it loads its song, even this one.
  useEffect(() => {
    if (!idle) return
    ytPost(frame.current, 'command', 'stopVideo')
    shown.current = ''
  }, [idle])
  // Next video: into the running player. Not loaded yet: onLoad sends it. Volume and live settings first: an embed
  // taken back from idle has its last song's.
  useEffect(() => {
    if (shown.current === videoId || !ready.current || tail) return
    shown.current = videoId
    usePlayer.getState().applyVolume(true)
    sendLive(undefined, true)
    ytPost(frame.current, 'command', 'loadVideoById', [videoId, usePlayer.getState().startAt / 1000])
  }, [videoId, tail])

  return (
    <iframe
      ref={(el) => {
        frame.current = el
        if (tail) return
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
        sendLive(undefined, true)
      }}
      // Hidden (cover shown instead): YouTube's minimum size, so it streams a low resolution nobody sees.
      style={tail ? undefined : (crop ?? (rect ? { left: rect.left, top: rect.top, width: hidden ? 200 : rect.width, height: hidden ? 200 : rect.height } : undefined))}
      // Bare video: no pointer on it, so YouTube's hover overlay never shows; our controls drive it.
      className={`fixed z-30 bg-black ${crop ? '' : 'rounded-lg border border-line'} ${src.controls && !hidden && !watch && !tail ? '' : 'pointer-events-none'} ${hidden || watch || tail ? 'opacity-0' : ''} ${rect && !tail ? '' : 'right-6 bottom-[100px] h-50 w-89 shadow-[0_12px_32px_var(--shadow)]'}`}
    />
  )
}

/** Knob, or YouTube-like speaker (click = mute) and bar. */
/** Sleep timer: a moon; on, it shows the time left (minute steps). */
function SleepButton() {
  const ends = useSleep((s) => s.ends)
  const [, tick] = useState(0)
  useEffect(() => {
    if (typeof ends !== 'number') return
    const id = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [ends])
  const left = sleepLabel(ends)
  return (
    <button type="button" title={tr('Sleep timer')} aria-label={left ? `${tr('Sleep timer')}: ${left}` : tr('Sleep timer')} onClick={(e) => openMenu(e, sleepMenu(), { place: 'above' })} className={`flex h-8 items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition hover:bg-raised ${left ? 'text-accent-ink' : 'text-ink-3 hover:text-ink'}`}>
      <Moon size={16} weight={left ? 'fill' : 'regular'} />
      {left && <span className="tabular-nums">{left}</span>}
    </button>
  )
}

export function VolumeControl({ big }: { big?: boolean }) {
  const volume = usePlayer((s) => s.volume)
  const setVolume = usePlayer((s) => s.setVolume)
  const toggleMute = usePlayer((s) => s.toggleMute)
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
  return (
    <span className="flex max-w-full min-w-0 items-center gap-1">
      <RoundButton label={volume > 0 ? tr('Mute') : tr('Unmute')} kind="plain" size={big ? 'md' : 'sm'} onClick={toggleMute}>
        <Icon size={big ? 20 : 16} />
      </RoundButton>
      <span className="relative flex min-w-0 items-center">
        <Bar label={tr('Volume')} value={volume} max={1} onChange={setVolume} className={`min-w-10 shrink ${big ? 'w-32' : 'w-24'}`} />
        <AdaptiveBar className="absolute inset-x-0 bottom-0" />
      </span>
    </span>
  )
}

/** Right panel switch (Up next, lyrics): Fill when open, again closes it. */
function PanelButton({ panel, label, icon: Icon }: { panel: 'upNext' | 'lyrics'; label: string; icon: typeof Queue }) {
  const on = useSettings((s) => s.settings.sidePanel === panel)
  const now = usePlayer((s) => !!s.now)
  return (
    <RoundButton label={label} aria-pressed={on} kind="plain" size="sm" disabled={!now} className={on ? 'text-ink!' : ''} onClick={() => useSettings.getState().update({ sidePanel: on ? 'none' : panel })}>
      <Icon size={19} weight={on ? 'fill' : 'regular'} />
    </RoundButton>
  )
}

/** One click saves the song (a hidden like caused a backlash at Spotify, docs/design.md). */
function LikeButton() {
  const track = useNowTrack()
  const liked = useLiked(track)
  if (!track) return null
  return (
    <RoundButton label={liked ? tr('Remove from Liked Music') : tr('Add to Liked Music')} aria-pressed={liked} kind="plain" size="sm" className={liked ? 'text-ink!' : ''} onClick={() => void toggleLike(track)}>
      <Heart size={19} weight={liked ? 'fill' : 'regular'} />
    </RoundButton>
  )
}

export function PlayerBar() {
  const now = usePlayer((s) => s.now)
  const tail = usePlayer((s) => s.tail)
  const frameKey = usePlayer((s) => s.frameKey)
  const playFiles = usePlayer((s) => s.playFiles)
  const onLocal = usePlayer((s) => s.onLocal)
  const onSpotify = usePlayer((s) => s.onSpotify)
  const setFull = usePlayer((s) => s.setFull)
  const readout = useSettings((s) => s.settings.readout)
  const sleepButton = useSettings((s) => s.settings.sleepButton)
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
    // On the window's background, under the panels (docs/design.md).
    <footer onContextMenu={onMenu(playerMenu)} className="flex h-22 shrink-0 items-center justify-between gap-6 px-4">
      {/* In key order: each iframe keeps its place as the two swap roles (a moved iframe reloads). */}
      {now?.youtubeId &&
        [...(tail ? [tail] : []), { key: frameKey, videoId: now.youtubeId }]
          .sort((a, b) => a.key - b.key)
          .map((f) => <YouTubeFrame key={f.key} videoId={f.videoId} tail={f === tail} idle={f === tail && !!tail?.done} />)}

      <div className="flex w-85 min-w-0 items-center gap-3">
        <button disabled={!now} onClick={() => setFull(true)} title={now ? tr('Open Now Playing') : undefined} className="shrink-0">
          {/* New song: its cover fades in. */}
          <Cover key={now?.trackId ?? now?.title} className="fade-in" title={now?.title ?? ''} art={track && trackArt(track)} size={56} />
        </button>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <button disabled={!now} onClick={() => setFull(true)} title={now ? tr('Open Now Playing') : undefined} className="max-w-full truncate text-left text-sm font-medium">
            {now?.title ?? tr('Nothing playing')}
          </button>
          {now ? <ArtistLink now={now} className="max-w-full truncate text-[0.8125rem] text-ink-2" /> : <span className="truncate text-[0.8125rem] text-ink-2">{tr('Play a YouTube track or drop audio files here')}</span>}
        </span>
        <LikeButton />
      </div>

      <div className="flex w-140 min-w-0 flex-col items-center gap-1">
        <Transport />
        <div className="flex w-full items-center gap-3 text-xs text-ink-2 tabular-nums">
          <TimeText part="elapsed" />
          <SeekBar className="flex-1" />
          <TimeText part="total" />
        </div>
      </div>

      <div className="flex w-85 items-center justify-end gap-2">
        {readout && now && (
          <span title={viaTitle(now.via, now.path)} className="grid size-8 shrink-0 place-items-center text-ink-2">
            <SourceIcon source={viaSource[now.via]} size={17} />
          </span>
        )}
        {sleepButton && <SleepButton />}
        <PanelButton panel="lyrics" label={tr('Lyrics')} icon={Quotes} />
        <PanelButton panel="upNext" label={tr('Up next')} icon={Queue} />
        <VolumeControl />
        <RoundButton label={tr('Now playing, full screen')} kind="plain" size="sm" disabled={!now} onClick={() => setFull(true)}>
          <ArrowsOutSimple size={18} />
        </RoundButton>
      </div>
    </footer>
  )
}
