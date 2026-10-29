import { useRef, type ButtonHTMLAttributes } from 'react'
import { formatCount } from '../format'
import { tr } from '../i18n/i18n'

const kinds = {
  primary: 'bg-accent text-on-accent hover:brightness-105',
  ink: 'bg-ink text-bg hover:opacity-85',
  ghost: 'border border-line text-ink hover:bg-raised',
  soft: 'border border-line bg-raised text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-bg',
  plain: 'text-ink-2 hover:bg-raised hover:text-ink',
}
const sizes = { xs: 'size-7', sm: 'size-8', md: 'size-10', lg: 'size-13', xl: 'size-[72px]' }

/** Icon-only round button. label = tooltip + accessible name. */
export function RoundButton({ label, kind = 'ghost', size = 'md', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; kind?: keyof typeof kinds; size?: keyof typeof sizes }) {
  return <button type="button" aria-label={label} title={label} className={`grid shrink-0 place-items-center rounded-full transition disabled:pointer-events-none disabled:opacity-35 ${kinds[kind]} ${sizes[size]} ${className}`} {...props} />
}

export const Led = ({ on }: { on: boolean }) => <span className="led" data-on={on} aria-hidden />

/** Filter chip: a pill, ink when picked, grey otherwise (YouTube's and Spotify's chips, docs/design.md). */
export function LedChip({ on, label, count, title, onClick }: { on: boolean; label: string; count?: string; title?: string; onClick: () => void }) {
  return (
    <button role="tab" aria-selected={on} title={title} onClick={onClick} className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition ${on ? 'bg-ink text-bg' : 'bg-raised text-ink hover:bg-line'}`}>
      {label}
      {count !== undefined && <span className={`text-xs tabular-nums ${on ? 'text-ink-4' : 'text-ink-3'}`}>{count}</span>}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`flex h-5 w-[34px] shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'bg-ink' : 'bg-line'}`}>
      <span className={`size-4 rounded-full bg-raised shadow-[0_1px_2px_var(--shadow)] transition-transform duration-200 ${checked ? 'translate-x-3.5' : ''}`} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex w-fit gap-0.5 rounded-full border border-line p-[3px] ${className}`}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${o.value === value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Big mono number in a recessed box (dialog summaries). */
export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line-soft bg-recess px-3 py-2.5">
      <span className="font-mono text-2xl tabular-nums">{formatCount(value)}</span>
      <span className="kicker">{label}</span>
    </div>
  )
}

/** Volume knob 0..1: drag up/down, wheel or arrows. Optional tick scale. */
export function Knob({ value, onChange, size = 32, ticks = false, label = tr('Volume') }: { value: number; onChange: (v: number) => void; size?: number; ticks?: boolean; label?: string }) {
  const start = useRef<{ y: number; v: number } | null>(null)
  const set = (v: number) => onChange(Math.min(1, Math.max(0, Math.round(v * 100) / 100)))
  const box = size + (ticks ? 20 : 0)
  const polar = (deg: number, r: number) => ({ transform: `rotate(${deg}deg) translateY(-${r}px)` })
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="relative grid shrink-0 cursor-ns-resize touch-none place-items-center rounded-full"
      style={{ width: box, height: box }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { y: e.clientY, v: value }
      }}
      onPointerMove={(e) => start.current && set(start.current.v + (start.current.y - e.clientY) / 150)}
      onPointerUp={() => (start.current = null)}
      onWheel={(e) => set(value - Math.sign(e.deltaY) * 0.05)}
      onKeyDown={(e) => {
        const d = ({ ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 } as Record<string, number>)[e.key]
        if (d) {
          e.preventDefault()
          set(value + d)
        }
      }}
    >
      {ticks && Array.from({ length: 11 }, (_, i) => <span key={i} className={`absolute size-[3px] rounded-full ${i / 10 <= value ? 'bg-ink-2' : 'bg-ink-4'}`} style={polar(-135 + 27 * i, size / 2 + 6)} />)}
      <span className="rounded-full border border-line bg-raised shadow-[0_1px_3px_var(--shadow)]" style={{ width: size, height: size }} />
      <span className="absolute size-1 rounded-full bg-accent" style={polar(-135 + 270 * value, size / 2 - 7)} />
    </div>
  )
}

/** Thin range bar; fill painted with a hard stop (no gradient look). seek = YouTube-like: accent fill, grows on hover. */
export function Bar({ label, value, max, onChange, className = '', seek = false }: { label: string; value: number; max: number; onChange: (v: number) => void; className?: string; seek?: boolean }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  const fill = 'var(--ink)'
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
      className={`bar ${seek ? 'seek' : ''} ${className}`}
      // backgroundImage, not background: the shorthand would reset the seek bar's size and position.
      style={{ backgroundImage: `linear-gradient(to right, ${fill} ${pct}%, var(--line) ${pct}%)` }}
    />
  )
}
