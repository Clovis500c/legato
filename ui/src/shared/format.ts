export function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.round((at - now) / 60_000)
  if (min > -1) return 'à l’instant'
  if (min > -60) return rtf.format(min, 'minute')
  return rtf.format(Math.round(min / 60), 'hour')
}

/** French thousands: 1 674. */
export const formatCount = (n: number) => n.toLocaleString('fr-FR')

/** Lowercase, no accents. For client-side search. */
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

/** Stable cover gradient per album: no network, no copyrighted art. */
export function coverGradient(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = h % 360
  return `linear-gradient(135deg, hsl(${hue} 80% 60%), hsl(${(hue + 40) % 360} 70% 40%))`
}
