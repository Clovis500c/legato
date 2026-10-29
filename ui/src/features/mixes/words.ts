import type { Mix } from '../../shared/api'
import { locale, msg, tr } from '../../shared/i18n/i18n'

/**
 * Mix titles and reasons in the interface's language, from what Rust says they're made of (`mix.words`). Rust's own
 * English title / reason stay the fallback for a mix this file doesn't know.
 */
const SLOTS = {
  morning: { title: msg('Your mornings'), reason: msg('What you usually play in the morning') },
  afternoon: { title: msg('Your afternoons'), reason: msg('What you usually play in the afternoon') },
  evening: { title: msg('Your evenings'), reason: msg('What you usually play in the evening') },
  night: { title: msg('Your nights'), reason: msg('What you usually play at night') },
}

const FIXED: Record<string, { title: string; reason: string }> = {
  repeat: { title: msg('On Repeat'), reason: msg('The songs you keep coming back to lately') },
  fresh: { title: msg('Fresh in your library'), reason: msg('Just added, barely played yet') },
  gems: { title: msg('Hidden gems'), reason: msg('Saved but never played here, by artists you like') },
  rediscover: { title: msg('Rediscover'), reason: msg('Tracks you loved, not played for two months') },
  discover: { title: msg('Discover Mix'), reason: msg('New to you, from radios of the songs you love') },
}

/** "A, B and C" in the language. */
export const listOf = (names: string[]) => new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(names)

/** Day name, 0 = Sunday ("Friday" / "vendredi"). */
export const weekdayName = (day: number, width: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(locale(), { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day)))

export function mixTitle(m: Mix): string {
  const w = m.words ?? {}
  if (m.id === 'now' && w.slot) return tr(SLOTS[w.slot].title)
  if (m.id === 'weekday' && w.day !== undefined) return tr('Your {day}s', { day: weekdayName(w.day) })
  if (m.id.startsWith('daily-') && w.number) return tr('Daily Mix {n}', { n: w.number })
  if (m.id.startsWith('artist-') && w.name) return tr('{name} Mix', { name: w.name })
  if (m.id === 'supermix') return tr('Supermix')
  return FIXED[m.id] ? tr(FIXED[m.id].title) : m.title
}

export function mixReason(m: Mix): string {
  const w = m.words ?? {}
  const names = w.names ?? []
  if (m.id === 'now' && w.slot) return tr(SLOTS[w.slot].reason)
  if (m.id === 'weekday' && w.day !== undefined) return tr('What you play on {day}s', { day: weekdayName(w.day) })
  if (m.id.startsWith('daily-') && names.length) return tr('Because you listen to {names}', { names: listOf(names) })
  if (m.id.startsWith('artist-') && w.name) return names.length ? tr('{name}, with {names}', { name: w.name, names: listOf(names) }) : tr('All {name}, your way', { name: w.name })
  if (m.id === 'supermix') return m.found?.length ? tr('Your favorites over the months, and new songs like them') : tr('Your favorites over the months')
  return FIXED[m.id] ? tr(FIXED[m.id].reason) : m.reason
}
