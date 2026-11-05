import type { Alarm } from '../../shared/theme/theme'

/** "07:30" → minutes after midnight, or null. */
export function minutesOf(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** The next ring after `now` (ms): the alarm's local time on one of its days. Null when off or no day is picked. */
export function nextAlarm(now: number, a: Pick<Alarm, 'on' | 'time' | 'days'>): number | null {
  const at = minutesOf(a.time)
  if (!a.on || at === null || !a.days.length) return null
  const d = new Date(now)
  for (let k = 0; k < 8; k++) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, Math.floor(at / 60), at % 60).getTime()
    if (t > now && a.days.includes(new Date(t).getDay())) return t
  }
  return null
}
