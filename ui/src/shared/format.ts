export function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.round((at - now) / 60_000)
  if (min > -1) return 'just now'
  if (min > -60) return rtf.format(min, 'minute')
  return rtf.format(Math.round(min / 60), 'hour')
}

/** Thousands separator: 1,674. */
export const formatCount = (n: number) => n.toLocaleString('en-US')

/** Lowercase, no accents. For client-side search. */
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
