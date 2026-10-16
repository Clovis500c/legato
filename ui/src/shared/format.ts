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

/** Spotify playlist or album link / URI (same rule as Rust spotify_embed::parse_link). */
export const spotifyList = (text: string) => /(open\.spotify\.com\/(intl-[a-z-]+\/)?(embed\/)?|spotify:)(playlist|album)[/:][A-Za-z0-9]{22}/.test(text)

/** Store country for catalogs, from UI locale. */
export const region = () => new Intl.Locale(navigator.language).maximize().region ?? 'US'

/** Lowercase, no accents. For client-side search. */
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
