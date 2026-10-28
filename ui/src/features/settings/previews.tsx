import { HardDrives, Moon, Pause, SkipBack, SkipForward, SpeakerHigh } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { useStore } from '../../app/store'
import { trackArt } from '../../shared/art'
import type { Settings } from '../../shared/theme/theme'
import { curvePath } from '../player/fade'
import { usePlayer } from '../player/store'
import { tr } from '../../shared/i18n/i18n'

// Live previews next to settings: small scenes drawn with the theme's tokens, redrawn as the value changes.

/** Stand-in cover: bold shapes in fixed colors (a cover keeps its colors whatever the theme). */
function SampleArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <rect width="100" height="100" fill="#1D2B53" />
      <circle cx="30" cy="38" r="30" fill="#FF6B35" />
      <circle cx="74" cy="66" r="26" fill="#00B4A6" />
      <rect x="44" y="8" width="22" height="22" rx="4" fill="#F7C548" transform="rotate(18 55 19)" />
    </svg>
  )
}

/** Song playing: its cover, so the preview shows your music. Else the stand-in. */
function Art({ className = '' }: { className?: string }) {
  const id = usePlayer((p) => p.now?.trackId)
  const track = useStore((s) => s.tracks.find((t) => t.id === id))
  const src = track && trackArt(track)[0]
  if (!src) return <SampleArt className={className} />
  return <img src={src} alt="" crossOrigin="anonymous" draggable={false} className={`object-cover ${className}`} />
}

/** 16:9 frame for a preview. */
function Frame({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div role="img" aria-label={label} className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border border-line bg-bg ${className}`}>
      {children}
    </div>
  )
}

const Lines = ({ w = 'w-10' }: { w?: string }) => (
  <span className="flex flex-col gap-[3px]">
    <span className={`h-[3px] rounded-full bg-ink ${w}`} />
    <span className="h-[3px] w-6 rounded-full bg-ink-3" />
  </span>
)

/**
 * Now Playing in small: blurred cover behind (immersive), or a flat tint, or the plain theme. Blur scaled to the
 * frame's size so it looks like the real screen. big = the scene above the Immersive settings.
 */
export function NowPlayingScene({ s, big = false }: { s: Pick<Settings, 'immersive' | 'tint' | 'backdropBlur' | 'backdropDim' | 'backdropMotion'>; big?: boolean }) {
  // Real screen ≈ 1400 px wide.
  const scale = (big ? 460 : 112) / 1400
  return (
    <Frame label={tr('Now Playing preview')} className={big ? 'w-full! max-w-115' : ''}>
      {s.immersive ? (
        <>
          <div className={`absolute -inset-[15%] ${s.backdropMotion ? 'preview-drift' : ''}`} style={{ filter: `blur(${s.backdropBlur * scale * 2.2}px)` }}>
            <Art className="size-full" />
          </div>
          <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--bg) ${s.backdropDim}%, transparent)` }} />
        </>
      ) : (
        s.tint && <div className="absolute inset-0" style={{ background: 'color-mix(in srgb, #1D2B53 70%, var(--bg))' }} />
      )}
      <div className={`absolute inset-0 flex items-center ${big ? 'gap-5 px-8' : 'gap-2 px-3'}`}>
        <div className={`shrink-0 overflow-hidden rounded-sm shadow-[0_4px_12px_var(--shadow)] ${big ? 'size-32' : 'size-9'}`}>
          <Art className="size-full" />
        </div>
        <div className={`flex min-w-0 flex-1 flex-col ${big ? 'gap-3' : 'gap-1.5'}`}>
          {big ? (
            <>
              <span className="h-2.5 w-40 rounded-full bg-ink" />
              <span className="h-2 w-24 rounded-full bg-ink-2" />
              <span className="mt-2 h-1 w-full rounded-full bg-ink-4">
                <span className="block h-full w-2/5 rounded-full bg-ink" />
              </span>
              <span className="flex items-center gap-3 text-ink">
                <SkipBack size={14} weight="fill" />
                <span className="grid size-7 place-items-center rounded-full bg-ink text-bg">
                  <Pause size={12} weight="fill" />
                </span>
                <SkipForward size={14} weight="fill" />
              </span>
            </>
          ) : (
            <>
              <Lines />
              <span className="h-[2px] w-full rounded-full bg-ink-4">
                <span className="block h-full w-2/5 rounded-full bg-ink" />
              </span>
            </>
          )}
        </div>
      </div>
    </Frame>
  )
}

/** Three rows at the chosen height (40 / 52 / 64 px scaled down). */
export function DensityScene({ density }: Pick<Settings, 'density'>) {
  const h = { compact: 10, comfort: 13, airy: 16 }[density]
  return (
    <Frame label={tr('List density preview')} className="flex flex-col justify-center px-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-1.5 border-b border-line-soft last:border-0" style={{ height: h }}>
          <span className="size-[7px] shrink-0 overflow-hidden rounded-[2px]">
            <SampleArt className="size-full" />
          </span>
          <Lines w={['w-12', 'w-9', 'w-14'][i]} />
        </div>
      ))}
    </Frame>
  )
}

/** Same cover in the three shapes, the chosen one lit. */
export function CoverShapes({ covers }: Pick<Settings, 'covers'>) {
  const radius = { net: '3px', rounded: '10px', vinyl: '999px' }
  return (
    <div className="flex items-center gap-3" aria-hidden>
      {(['net', 'rounded', 'vinyl'] as const).map((c) => (
        <span key={c} className={`size-11 overflow-hidden transition-[opacity,transform] ${c === covers ? 'scale-105 opacity-100 shadow-[0_4px_12px_var(--shadow)]' : 'opacity-35'}`} style={{ borderRadius: radius[c] }}>
          <SampleArt className="size-full" />
        </span>
      ))}
    </div>
  )
}

/** Progress bar: tuner scale with ticks, or a plain line. */
export function TunerScene({ tuner }: Pick<Settings, 'tuner'>) {
  return (
    <Frame label={tr('Progress bar preview')} className="flex items-center px-3">
      {tuner ? (
        <svg viewBox="0 0 100 20" className="w-full" aria-hidden>
          {Array.from({ length: 21 }, (_, i) => (
            <line key={i} x1={i * 5} x2={i * 5} y1={i % 5 ? 9 : 5} y2={15} className="stroke-ink-3" strokeWidth={0.8} />
          ))}
          <line x1={38} x2={38} y1={2} y2={18} className="stroke-accent" strokeWidth={2} />
        </svg>
      ) : (
        <span className="h-[3px] w-full rounded-full bg-ink-4">
          <span className="block h-full w-[38%] rounded-full bg-ink" />
        </span>
      )}
    </Frame>
  )
}

/** App window with or without the floating mini player. */
export function MiniPlayerScene({ miniPlayer }: Pick<Settings, 'miniPlayer'>) {
  return (
    <Frame label={tr('Mini player preview')}>
      <div className="absolute inset-y-0 left-0 w-5 border-r border-line-soft bg-panel" />
      <div className="absolute top-2 left-7 flex flex-col gap-1.5">
        <Lines w="w-12" />
        <Lines w="w-9" />
      </div>
      {miniPlayer && (
        <div className="absolute right-1.5 bottom-2 w-11 overflow-hidden rounded-[3px] border border-line bg-panel shadow-[0_3px_8px_var(--shadow)]">
          <Art className="aspect-video w-full" />
          <div className="p-1">
            <span className="block h-[2px] w-6 rounded-full bg-ink" />
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1.5 border-t border-line-soft bg-panel" />
    </Frame>
  )
}

/** Player bar end: source icon or nothing, then volume. */
export function SourceIconScene({ readout }: Pick<Settings, 'readout'>) {
  return (
    <Frame label={tr('Source icon preview')} className="flex items-center justify-end gap-2 px-3">
      {readout && <HardDrives size={12} className="text-ink-2" />}
      <span className="h-[3px] w-10 rounded-full bg-ink-4">
        <span className="block h-full w-3/4 rounded-full bg-ink" />
      </span>
    </Frame>
  )
}

/** Player bar end: the sleep timer's moon or nothing, then volume. */
export function SleepButtonScene({ sleepButton }: Pick<Settings, 'sleepButton'>) {
  return (
    <Frame label={tr('Sleep timer button preview')} className="flex items-center justify-end gap-2 px-3">
      {sleepButton && <Moon size={12} className="text-ink-2" />}
      <span className="h-[3px] w-10 rounded-full bg-ink-4">
        <span className="block h-full w-3/4 rounded-full bg-ink" />
      </span>
    </Frame>
  )
}

/** Rows with or without a small cover. */
export function ListCoversScene({ listCovers }: Pick<Settings, 'listCovers'>) {
  return (
    <Frame label={tr('Covers in lists preview')} className="flex flex-col justify-center gap-2 px-2.5">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-1.5">
          {listCovers && (
            <span className="size-3 shrink-0 overflow-hidden rounded-[2px]">
              <SampleArt className="size-full" />
            </span>
          )}
          <Lines w={i ? 'w-9' : 'w-12'} />
        </div>
      ))}
    </Frame>
  )
}

/** Sidebar entries with or without their song count. */
export function CountsScene({ sidebarCounts }: Pick<Settings, 'sidebarCounts'>) {
  return (
    <Frame label={tr('Sidebar counts preview')} className="flex flex-col justify-center gap-2 bg-panel! px-2.5">
      {['w-10', 'w-8', 'w-12'].map((w, i) => (
        <div key={w} className="flex items-center justify-between">
          <span className={`h-[3px] rounded-full bg-ink-2 ${w}`} />
          {sidebarCounts && <span className="font-mono text-[0.375rem] leading-none text-ink-3">{[248, 31, 1204][i]}</span>}
        </div>
      ))}
    </Frame>
  )
}

/** A dot that glides when animations are on, jumps when off. */
export function MotionScene({ motion }: Pick<Settings, 'motion'>) {
  return (
    <Frame label={tr('Animations preview')} className="flex items-center px-3">
      <span className="h-px w-full bg-line" />
      <span className={`absolute top-1/2 left-3 size-3 -translate-y-1/2 rounded-full bg-accent ${motion ? 'preview-glide' : 'preview-jump'}`} />
    </Frame>
  )
}

/** Simple fade: both songs' volume around the change. */
export function FadeScene({ crossfade }: Pick<Settings, 'crossfade'>) {
  // 12 s over 46 units; songs overlap (X) around the middle.
  const w = (crossfade / 12) * 46
  const a = 50 - w / 2
  const b = 50 + w / 2
  const out = crossfade ? `M2,6L${a},6` + curvePath('scurve', a, b, 34, 6, 16, true).replace('M', 'L') : 'M2,6L50,6L50,34'
  const inn = crossfade ? curvePath('scurve', a, b, 34, 6, 16) + 'L98,6' : 'M50,34L50,6L98,6'
  return (
    <Frame label={tr('Fade preview')} className="px-1.5">
      <svg viewBox="0 0 100 40" className="size-full" aria-hidden>
        <path d={out} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />
        <path d={inn} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </Frame>
  )
}

/** Volume as a knob or as a speaker and bar. */
export function VolumeScene({ volume }: Pick<Settings, 'volume'>) {
  return (
    <Frame label={tr('Volume control preview')} className="flex items-center justify-center gap-1.5">
      {volume === 'knob' ? (
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
          <circle cx="12" cy="12" r="10" className="fill-raised stroke-line" strokeWidth={1.5} />
          <line x1="12" y1="12" x2="17.5" y2="6.5" className="stroke-ink" strokeWidth={2} strokeLinecap="round" />
        </svg>
      ) : (
        <>
          <SpeakerHigh size={12} className="text-ink-2" />
          <span className="h-[3px] w-12 rounded-full bg-ink-4">
            <span className="block h-full w-3/4 rounded-full bg-ink" />
          </span>
        </>
      )}
    </Frame>
  )
}

/** Mix cover: four song covers, the first one, or the numbered tile. */
export function MixCoverScene({ mixCovers }: Pick<Settings, 'mixCovers'>) {
  return (
    <div role="img" aria-label={tr('Mix cover preview')} className="relative size-16 shrink-0 overflow-hidden rounded-md border border-line bg-recess">
      {mixCovers === 'grid' && (
        <span className="grid size-full grid-cols-2">
          {[0, 90, 180, 270].map((h) => (
            <span key={h} style={{ filter: `hue-rotate(${h}deg)` }}>
              <SampleArt className="size-full" />
            </span>
          ))}
        </span>
      )}
      {mixCovers === 'single' && <SampleArt className="size-full" />}
      {mixCovers === 'template' && <span className="grid size-full place-items-center font-mono text-lg font-semibold text-ink-2">01</span>}
      <span className="absolute top-1 left-1 rounded-full bg-black/60 px-1 font-mono text-[0.375rem] tracking-[0.08em] text-white uppercase">{tr('Daily')}</span>
    </div>
  )
}
