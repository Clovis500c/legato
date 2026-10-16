import { Play } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useSettings } from '../../app/settings'
import { FADE_CURVES, type FadeCurve, type FadeSettings } from '../../shared/theme/theme'
import { Segmented, Toggle } from '../../shared/ui/controls'
import { curveHints, curveLabels, curvePath, DEMO_GAP, demoLength, effectiveFade, shape, type Fade } from '../player/fade'
import { usePlayer } from '../player/store'

// Graph geometry (viewBox units). Two halves: end of the song, start of the next; 12 s each.
const W = 640
const H = 230
const TOP = 26
const BASE = H - 34
const L0 = 44
const GAP = 28
const HALF = (W - 16 - L0 - GAP) / 2
const R0 = L0 + HALF + GAP
const MAX = 12
const k = HALF / MAX
const xOut = (t: number) => L0 + HALF + t * k // t ≤ 0
const xIn = (t: number) => R0 + t * k // t ≥ 0
const y = (g: number) => BASE - g * (BASE - TOP)
const snap = (s: number) => Math.min(MAX, Math.max(0, Math.round(s * 2) / 2))
const pct = (g: number) => `${Math.round(g * 100)} %`
// Loudness as audio tools show it.
const db = (g: number) => (g >= 0.999 ? '0 dB' : g <= 0.001 ? '−∞ dB' : `${Math.round(20 * Math.log10(g))} dB`.replace('-', '−'))

/** Where a pointer is in viewBox units. */
function svgX(svg: SVGSVGElement, clientX: number) {
  const r = svg.getBoundingClientRect()
  return ((clientX - r.left) / r.width) * W
}

/** Point on the curves under viewBox x: side, seconds from the song change, volume. */
function probe(x: number, f: Fade): { side: 'out' | 'in'; t: number; g: number } | null {
  if (x >= L0 && x <= L0 + HALF) {
    const t = (x - L0 - HALF) / k
    return { side: 'out', t, g: f.out > 0 && -t <= f.out ? shape(f.outCurve, -t / f.out) : -t > 0 ? 1 : 0 }
  }
  if (x >= R0 && x <= R0 + HALF) {
    const t = (x - R0) / k
    return { side: 'in', t, g: f.in > 0 ? shape(f.inCurve, t / f.in) : 1 }
  }
  return null
}

/** Volume over time around a song change, with drag handles for both lengths. playhead = preview time, seconds. */
export function FadeGraph({ fade, onChange, playhead }: { fade: Fade; onChange: (patch: Partial<FadeSettings>) => void; playhead: number | null }) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'out' | 'in' | null>(null)
  const [hover, setHover] = useState<ReturnType<typeof probe>>(null)

  // Full volume until the fade starts, then down to the song change; next song up from it, then full.
  const outLine = `M${xOut(-MAX)},${y(1)}` + (fade.out > 0 ? curvePath(fade.outCurve, xOut(-fade.out), xOut(0), y(0), y(1), 32, true).replace('M', 'L') : `L${xOut(0)},${y(1)}L${xOut(0)},${y(0)}`)
  const inLine = (fade.in > 0 ? curvePath(fade.inCurve, xIn(0), xIn(fade.in), y(0), y(1)) : `M${xIn(0)},${y(0)}L${xIn(0)},${y(1)}`) + `L${xIn(MAX)},${y(1)}`

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const x = svgX(e.currentTarget, e.clientX)
    if (drag === 'out') return onChange({ out: snap((L0 + HALF - x) / k) })
    if (drag === 'in') return onChange({ in: snap((x - R0) / k) })
    setHover(probe(x, fade))
  }
  const keys = (side: 'out' | 'in') => (e: KeyboardEvent<SVGGElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.5 : 0
    if (!d) return
    e.preventDefault()
    // Left on the fade-out handle = longer fade (handle moves away from the change).
    onChange(side === 'out' ? { out: snap(fade.out - d) } : { in: snap(fade.in + d) })
  }

  // Preview time → x: fade out, gap, fade in.
  const head = playhead === null ? null : playhead < fade.out ? xOut(playhead - fade.out) : playhead < fade.out + DEMO_GAP ? L0 + HALF + ((playhead - fade.out) / DEMO_GAP) * GAP : xIn(playhead - fade.out - DEMO_GAP)
  const handle = (side: 'out' | 'in', x: number, value: number) => (
    <g
      role="slider"
      tabIndex={0}
      aria-label={side === 'out' ? 'Fade out length' : 'Fade in length'}
      aria-valuemin={0}
      aria-valuemax={MAX}
      aria-valuenow={value}
      aria-valuetext={`${value} seconds`}
      onKeyDown={keys(side)}
      onPointerDown={(e) => {
        e.stopPropagation()
        svg.current?.setPointerCapture(e.pointerId)
        setDrag(side)
        setHover(null)
      }}
      className="cursor-ew-resize outline-none [&:focus-visible>circle:last-child]:stroke-ink"
    >
      <text x={x} y={y(1) - 12} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
        {value} s
      </text>
      <circle cx={x} cy={y(1)} r={14} fill="transparent" />
      <circle cx={x} cy={y(1)} r={drag === side ? 8 : 6.5} className={`${side === 'out' ? 'fill-accent' : 'fill-ink'} stroke-raised transition-[r]`} strokeWidth={2.5} />
    </g>
  )

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none select-none"
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => !drag && setHover(null)}
      role="group"
      aria-label="Volume of both songs around a song change"
    >
      {/* Grid: volume lines, second ticks. */}
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={L0} x2={W - 16} y1={y(g)} y2={y(g)} className="stroke-line-soft" strokeDasharray={g === 0 ? undefined : '3 4'} />
          <text x={L0 - 8} y={y(g) + 3.5} textAnchor="end" className="fill-ink-3 font-mono text-[9px]">
            {g === 0 ? '0' : pct(g)}
          </text>
        </g>
      ))}
      {Array.from({ length: MAX / 2 + 1 }, (_, i) => i * 2).map((s) => (
        <g key={s} className="fill-ink-3 font-mono text-[9px]">
          <text x={xOut(-s)} y={BASE + 16} textAnchor="middle">
            {s ? `−${s}` : '0'}
          </text>
          <text x={xIn(s)} y={BASE + 16} textAnchor="middle">
            {s ? `+${s}` : '0'}
          </text>
        </g>
      ))}
      <text x={L0} y={12} className="fill-ink-3 font-mono text-[9px] tracking-[0.09em]">
        SONG ENDS
      </text>
      <text x={R0} y={12} className="fill-ink-3 font-mono text-[9px] tracking-[0.09em]">
        NEXT SONG
      </text>
      {/* Song change. */}
      <rect x={L0 + HALF} y={TOP} width={GAP} height={BASE - TOP} className="fill-ink" fillOpacity={0.05} />

      {/* Curves: filled under, line on top. */}
      <path d={`${outLine}L${xOut(0)},${y(0)}L${xOut(-MAX)},${y(0)}Z`} className="fill-accent" fillOpacity={0.14} />
      <path d={outLine} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={`${inLine}L${xIn(MAX)},${y(0)}L${xIn(0)},${y(0)}Z`} className="fill-ink" fillOpacity={0.08} />
      <path d={inLine} fill="none" className="stroke-ink" strokeWidth={2.5} strokeLinejoin="round" />

      {hover && !drag && (
        <g pointerEvents="none">
          <line x1={hover.side === 'out' ? xOut(hover.t) : xIn(hover.t)} x2={hover.side === 'out' ? xOut(hover.t) : xIn(hover.t)} y1={TOP} y2={BASE} className="stroke-ink-3" strokeDasharray="2 3" />
          <circle cx={hover.side === 'out' ? xOut(hover.t) : xIn(hover.t)} cy={y(hover.g)} r={4} className={hover.side === 'out' ? 'fill-accent' : 'fill-ink'} />
          <text x={(hover.side === 'out' ? xOut(hover.t) : xIn(hover.t)) + (hover.side === 'out' ? 8 : -8)} y={Math.max(TOP + 10, y(hover.g) - 8)} textAnchor={hover.side === 'out' ? 'start' : 'end'} className="fill-ink font-mono text-[10px]">
            {`${hover.t < 0 ? '−' : '+'}${Math.abs(hover.t).toFixed(1)} s · ${pct(hover.g)} · ${db(hover.g)}`}
          </text>
        </g>
      )}
      {head !== null && <line x1={head} x2={head} y1={TOP - 6} y2={BASE} className="stroke-accent" strokeWidth={2} pointerEvents="none" />}

      {handle('out', xOut(-fade.out), fade.out)}
      {handle('in', xIn(fade.in), fade.in)}
    </svg>
  )
}

/** Tiny picture of a curve for its button. */
function CurveIcon({ curve, falling }: { curve: FadeCurve; falling: boolean }) {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6" aria-hidden>
      <path d={curvePath(curve, 2, 22, 14, 2, 16, falling)} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function Side({ side, fade, set }: { side: 'out' | 'in'; fade: FadeSettings; set: (p: Partial<FadeSettings>) => void }) {
  const secs = side === 'out' ? fade.out : fade.in
  const curve = side === 'out' ? fade.outCurve : fade.inCurve
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
      <div className="flex items-baseline justify-between">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <span className={`size-2.5 rounded-full ${side === 'out' ? 'bg-accent' : 'bg-ink'}`} />
          {side === 'out' ? 'Fade out' : 'Fade in'}
        </p>
        <span className="font-mono text-xs text-ink-2">{secs ? `${secs} s` : 'Off'}</span>
      </div>
      <input
        type="range"
        aria-label={side === 'out' ? 'Fade out length' : 'Fade in length'}
        min={0}
        max={MAX}
        step={0.5}
        value={secs}
        onChange={(e) => set(side === 'out' ? { out: +e.target.value } : { in: +e.target.value })}
        className="bar w-full"
        style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${(secs / MAX) * 100}%, var(--line) 0)` }}
      />
      <div role="radiogroup" aria-label={side === 'out' ? 'Fade out shape' : 'Fade in shape'} className="grid grid-cols-5 gap-1">
        {FADE_CURVES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={c === curve}
            title={`${curveLabels[c]}: ${curveHints[c]}`}
            onClick={() => set(side === 'out' ? { outCurve: c } : { inCurve: c })}
            className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition ${c === curve ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-bg hover:text-ink'}`}
          >
            <CurveIcon curve={c} falling={side === 'out'} />
            <span className="leading-tight">{curveLabels[c]}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">{curveHints[curve]}</p>
    </div>
  )
}

// Ready-made fades: shapes people know from radio, DJ mixers and audio editors.
const PRESETS: { label: string; fade: Partial<FadeSettings> }[] = [
  { label: 'Smooth', fade: { out: 5, in: 5, outCurve: 'scurve', inCurve: 'scurve' } },
  { label: 'DJ mix', fade: { out: 8, in: 8, outCurve: 'equal', inCurve: 'equal' } },
  { label: 'Radio', fade: { out: 3, in: 1, outCurve: 'exp', inCurve: 'log' } },
  { label: 'Quick', fade: { out: 1.5, in: 1.5, outCurve: 'linear', inCurve: 'linear' } },
  { label: 'Long tail', fade: { out: 12, in: 2, outCurve: 'exp', inCurve: 'scurve' } },
]

/** Settings › Advanced: the whole fade, with its graph. */
export function FadeEditor() {
  const { settings: s, update } = useSettings()
  const f = s.fade
  const set = (patch: Partial<FadeSettings>) => update({ fade: { ...f, ...patch } })
  const now = usePlayer((p) => p.now)
  const playing = usePlayer((p) => p.playing)
  const fade = effectiveFade({ crossfade: s.crossfade, fade: { ...f, advanced: true } })
  const [head, setHead] = useState<number | null>(null)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const preview = () => {
    cancelAnimationFrame(raf.current)
    if (now && playing) usePlayer.getState().previewFade()
    const start = performance.now()
    const length = demoLength(fade)
    const tick = () => {
      const t = (performance.now() - start) / 1000
      setHead(t < length ? t : null)
      if (t < length) raf.current = requestAnimationFrame(tick)
    }
    tick()
  }
  const preset = PRESETS.find((p) => Object.entries(p.fade).every(([key, v]) => f[key as keyof FadeSettings] === v))

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-raised px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Fade presets" className="flex flex-1 flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.label} role="radio" aria-checked={preset === p} onClick={() => set(p.fade)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${preset === p ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:text-ink'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={preview} title={now && playing ? 'Plays a song change on the current song' : 'Play a song to hear it; the graph shows it meanwhile'} className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-on-accent transition hover:opacity-90">
            <Play size={12} weight="fill" /> {now && playing ? 'Try on this song' : 'Preview'}
          </button>
        </div>
        <FadeGraph fade={fade} onChange={set} playhead={head} />
        <p className="pb-1 text-xs text-ink-3">Drag the dots to change the lengths. Hover a curve to read the volume.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Side side="out" fade={f} set={set} />
        <Side side="in" fade={f} set={set} />
      </div>
      <div className="rounded-xl border border-line bg-raised">
        <div data-setting="Fade in after a skip" className="flex items-center gap-4 border-b border-line-soft px-4 py-3">
          <div className="flex-1">
            <p className="text-[13px] font-medium">Fade in after a skip</p>
            <p className="text-xs text-ink-2">Songs you pick yourself fade in too, not only the ones that follow on their own</p>
          </div>
          <Toggle label="Fade in after a skip" checked={f.skip} onChange={(skip) => set({ skip })} />
        </div>
        <div data-setting="Fade on pause and play" className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1">
            <p className="text-[13px] font-medium">Fade on pause and play</p>
            <p className="text-xs text-ink-2">Volume glides down before a pause and back up after (not with Spotify)</p>
          </div>
          <Segmented
            label="Fade on pause and play"
            value={String(f.pause)}
            onChange={(v) => set({ pause: +v })}
            options={[
              { value: '0', label: 'Off' },
              { value: '200', label: '0.2 s' },
              { value: '500', label: '0.5 s' },
              { value: '1000', label: '1 s' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
