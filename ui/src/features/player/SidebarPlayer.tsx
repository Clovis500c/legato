import { ArrowsOutSimple, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { RoundButton } from '../../shared/ui/controls'
import { playerMenu } from '../menus'
import { averageColor, type Rgb } from './ambient'
import { VideoSlot } from './NowPlaying'
import { usePosition } from './Progress'
import { useNowTrack, usePlayer } from './store'

/** Art width inside the card: sidebar 252 px, card margins, border and padding. */
const ART = 214

/** Average color of the art, for the card's soft glow. */
function useGlow(src: string | undefined): Rgb | null {
  const [glow, setGlow] = useState<{ src: string; rgb: Rgb | null }>()
  useEffect(() => {
    if (!src) return
    let live = true
    void averageColor(src).then((rgb) => live && setGlow({ src, rgb }))
    return () => {
      live = false
    }
  }, [src])
  return glow && glow.src === src ? glow.rgb : null
}

/** Thin line of the song's progress along the card's bottom (the bar below seeks). */
function ProgressLine() {
  const durationMs = usePlayer((s) => s.durationMs)
  const pos = usePosition(durationMs ? durationMs / 500 : 1000)
  const k = durationMs ? Math.min(1, pos / durationMs) : 0
  return (
    <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-line-soft">
      <span className="absolute inset-0 origin-left bg-accent" style={{ transform: `scaleX(${k})` }} />
    </span>
  )
}

/**
 * Vinyl covers (user's request 2026-10-22): the song as a record, its cover the label, turning at 33⅓ rpm while it
 * plays (stops where it is on pause). The light on the grooves stays put, like on a real deck; the arm swings onto
 * the record when it plays. Click: play / pause.
 */
function Record({ title, art, playing, spin, onClick }: { title: string; art?: string[]; playing: boolean; spin: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={playing ? tr('Pause') : tr('Play')} className="group relative mx-auto block size-[214px] shrink-0">
      <span className={`vinyl absolute inset-[6px] rounded-full ${spin ? 'vinyl-spin' : ''}`} style={{ animationPlayState: playing ? 'running' : 'paused' }}>
        <span className="absolute inset-[30%] overflow-hidden rounded-full shadow-[0_0_0_2px_rgb(0_0_0/0.55)]">
          <Cover title={title} art={art} size={Math.round((ART - 12) * 0.4)} className="rounded-none! border-0!" />
        </span>
        <span className="absolute top-1/2 left-1/2 size-2.5 -translate-1/2 rounded-full bg-panel shadow-[inset_0_1px_2px_rgb(0_0_0/0.6)]" />
      </span>
      <span aria-hidden className="vinyl-sheen pointer-events-none absolute inset-[6px] rounded-full" />
      <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 transition-transform duration-700 ease-out" style={{ transformOrigin: '90% 10%', transform: `rotate(${playing ? 0 : -24}deg)` }}>
        <circle cx="90" cy="10" r="6" className="fill-raised stroke-line" strokeWidth="1" />
        <circle cx="90" cy="10" r="2.2" className="fill-ink-3" />
        <path d="M90 10 L82 58 L72 70" fill="none" className="stroke-ink-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="66" y="66" width="9" height="6" rx="1.2" transform="rotate(40 70.5 69)" className="fill-ink-2" />
      </svg>
      <span className="absolute top-1/2 left-1/2 grid size-10 -translate-1/2 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
      </span>
    </button>
  )
}

/**
 * Mini player docked at the bottom of the sidebar (user's pick 2026-10-22): never over the content. A card tinted by the
 * cover, the song's progress along its bottom. YouTube: the video fills a 200 px tall slot (YouTube's minimum, it stays
 * visible; the 16:9 frame is wider, its sides cut). Other sources: the cover (a turning record with vinyl covers), only
 * when the mini player is on. Click the art: play / pause; the title opens Now Playing.
 */
export function SidebarPlayer() {
  const now = usePlayer((s) => s.now)
  const full = usePlayer((s) => s.full)
  const playing = usePlayer((s) => s.playing)
  const setFull = usePlayer((s) => s.setFull)
  const toggle = usePlayer((s) => s.toggle)
  const docked = useSettings((s) => s.settings.miniPlace === 'sidebar')
  const on = useSettings((s) => s.settings.miniPlayer)
  const vinyl = useSettings((s) => s.settings.covers === 'vinyl')
  const motion = useSettings((s) => s.settings.motion)
  const track = useNowTrack()
  const art = track ? trackArt(track) : undefined
  const glow = useGlow(art?.[0])
  const video = now?.via === 'youtube'
  if (!now || full || !docked || !(video || on)) return null
  return (
    <section
      aria-label={tr('Mini player')}
      onContextMenu={onMenu(playerMenu)}
      className="relative mx-2 mt-1 mb-2 flex shrink-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-line-soft bg-raised p-2.5 pb-3 shadow-[0_8px_24px_var(--shadow)]"
    >
      {glow && <span aria-hidden className="pointer-events-none absolute inset-0 transition-[background] duration-700" style={{ background: `radial-gradient(130% 75% at 50% 0%, rgb(${glow.join(' ')} / 0.32), transparent 72%)` }} />}
      {video ? (
        <VideoSlot fill onClick={toggle} className="relative h-50 w-full shadow-[0_6px_18px_rgb(0_0_0/0.35)]" />
      ) : vinyl ? (
        <Record title={now.title} art={art} playing={playing} spin={motion} onClick={toggle} />
      ) : (
        <button onClick={toggle} title={playing ? tr('Pause') : tr('Play')} className="group relative block">
          <Cover title={now.title} art={art} size={ART} className="shadow-[0_6px_18px_rgb(0_0_0/0.35)]" />
          <span className="absolute top-1/2 left-1/2 grid size-11 -translate-1/2 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          </span>
        </button>
      )}
      <div className="relative flex items-center gap-1.5">
        <button onClick={() => setFull(true)} className="min-w-0 flex-1 text-left" title={tr('Open Now Playing')}>
          <span className="block truncate text-[0.8125rem] font-semibold hover:underline">{now.title}</span>
          <span className="block truncate text-xs text-ink-2">{now.artist}</span>
        </button>
        <RoundButton label={playing ? tr('Pause') : tr('Play')} kind="soft" size="sm" onClick={toggle}>
          {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
        </RoundButton>
        <RoundButton label={tr('Now playing, full screen')} kind="plain" size="sm" onClick={() => setFull(true)}>
          <ArrowsOutSimple size={13} />
        </RoundButton>
      </div>
      <ProgressLine />
    </section>
  )
}
