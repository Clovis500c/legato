import { Star } from '@phosphor-icons/react'
import { useState } from 'react'
import { starsText } from '../format'
import { tr } from '../i18n/i18n'

/**
 * Five stars, halves allowed: a star's left half gives half a star; the rating it has, clicked again, takes it off.
 * Value and changes in half stars (0..10). A slider for the keyboard: ← → half a star, 1–5 whole stars, 0 or Delete none.
 */
export function Stars({ value, onChange, size = 14, className = '' }: { value: number; onChange: (half: number) => void; size?: number; className?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value
  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(10, Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * 10)))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const to = e.key === 'ArrowRight' ? Math.min(10, value + 1) : e.key === 'ArrowLeft' ? Math.max(0, value - 1) : /^[0-5]$/.test(e.key) ? Number(e.key) * 2 : e.key === 'Delete' || e.key === 'Backspace' ? 0 : null
    if (to === null) return
    // A list's own keys (Delete removes from a playlist) stay out of it.
    e.preventDefault()
    e.stopPropagation()
    if (to !== value) onChange(to)
  }
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={tr('Rating')}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value / 2}
      aria-valuetext={starsText(value)}
      onPointerMove={(e) => setHover(at(e))}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        const half = at(e)
        onChange(half === value ? 0 : half)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={onKey}
      className={`inline-flex cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${className}`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.min(1, Math.max(0, (shown - i * 2) / 2))
        return (
          <span key={i} className="relative block shrink-0" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-ink-4" />
            {fill > 0 && (
              <span className="absolute inset-y-0 start-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star size={size} weight="fill" className={`block ${hover === null ? 'text-ink-2' : 'text-ink-3'}`} />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
