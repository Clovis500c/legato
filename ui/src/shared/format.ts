import { locale, tr } from './i18n/i18n'
export function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

export function timeAgo(at: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const min = Math.round((at - now) / 60_000)
  if (min > -1) return tr('just now')
  if (min > -60) return rtf.format(min, 'minute')
  if (min > -60 * 24) return rtf.format(Math.round(min / 60), 'hour')
  return rtf.format(Math.round(min / 60 / 24), 'day')
}

/** 1.2 MB, 340 KB. */
export function formatBytes(n: number): string {
  if (n < 1024) return tr('{n} B', { n })
  if (n < 1024 * 1024) return tr('{n} KB', { n: Math.round(n / 1024) })
  return tr('{n} MB', { n: (n / 1024 / 1024).toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })
}

/** Thousands separator, the language's: 1,674 / 1 674. */
export const formatCount = (n: number) => n.toLocaleString(locale())

/** Spotify playlist or album link / URI (same rule as Rust spotify_embed::parse_link). */
export const spotifyList = (text: string) => /(open\.spotify\.com\/(intl-[a-z-]+\/)?(embed\/)?|spotify:)(playlist|album)[/:][A-Za-z0-9]{22}/.test(text)

/** Deezer playlist / album link (a song's too, said plain by Rust) or short link: same rule as Rust deezer::target, the link alone. */
export const deezerLink = (text: string) => /^\s*(https?:\/\/)?((www\.)?deezer\.com\/([a-z]{2}(-[a-z]{2})?\/)?(playlist|album|track)\/\d+|link\.deezer\.com\/s\/[A-Za-z0-9]+)\S*\s*$/i.test(text)

/** Apple Music album / playlist link (a song's too, said plain by Rust): same rule as Rust itunes::apple_target, the link alone. */
export const appleLink = (text: string) => /^\s*(https?:\/\/)?music\.apple\.com\/([a-z]{2}\/)?(album|playlist|song)\/\S+\s*$/i.test(text)

/** Store country for catalogs, from UI locale. */
export const region = () => new Intl.Locale(navigator.language).maximize().region ?? 'US'

/** Lowercase, no accents. For client-side search. */
/** File name from a title: no characters Windows refuses, no trailing dot or space, short. */
export const fileName = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, '') || 'cover'

export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
