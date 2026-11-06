import { UsersThree } from '@phosphor-icons/react'
import { tr } from '../../shared/i18n/i18n'
import { emoji, inRoom, openRoom, useRoom } from './room'

/** In a room: a small pill in the player, the room's view on a click. `compact`: the icon and how many are in it
 *  (the PC's player bar, already full), its words in the tooltip. */
export function RoomPill({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const s = useRoom((x) => x.status)
  if (!s || !inRoom(s)) return null
  const label = s.role === 'host' ? tr('Your room · {n}', { n: s.people.length }) : tr('Following {name}', { name: s.host })
  return (
    <button type="button" onClick={openRoom} title={`${tr('Listening room')} · ${label}`} aria-label={label} className={`glow-on flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-raised px-2.5 text-xs font-semibold text-ink tabular-nums transition hover:brightness-110 ${className}`}>
      <UsersThree size={15} className="shrink-0 text-accent-ink" />
      <span className="truncate">{compact ? s.people.length + (s.role === 'listener' ? 1 : 0) : label}</span>
    </button>
  )
}

/** The room's reactions, floating a moment over the cover they're placed on (its parent positioned). */
export function RoomFloats({ big = false }: { big?: boolean }) {
  const floats = useRoom((x) => x.floats)
  if (!floats.length) return null
  return (
    <span aria-live="polite" className="pointer-events-none absolute inset-0 z-10">
      {floats.map((f) => (
        <span key={f.id} className={`room-float absolute bottom-[8%] leading-none ${big ? 'text-5xl' : 'text-2xl'}`} style={{ left: `${12 + ((f.id * 37) % 66)}%` }}>
          {emoji(f.reaction)}
          <span className="sr-only">{f.from}</span>
        </span>
      ))}
    </span>
  )
}
