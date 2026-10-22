import { msg } from '../../shared/i18n/i18n'
/** Video flavour from a YouTube title. Music first: covers / karaoke hidden by default. */
export type Kind = 'clip' | 'live' | 'cover' | 'karaoke' | 'lyrics' | null

export function videoKind(title: string): Kind {
  const t = title.toLowerCase()
  if (/karaok/.test(t)) return 'karaoke'
  if (/\b(cover|reprise)\b/.test(t)) return 'cover'
  if (/\blive\b|en concert|\bconcert\b/.test(t)) return 'live'
  if (/\b(lyrics?|paroles)\b/.test(t)) return 'lyrics'
  if (/(official (music )?video|clip officiel|\bclip\b)/.test(t)) return 'clip'
  return null
}

export const kindLabel: Record<Exclude<Kind, null>, string> = { clip: msg('CLIP'), live: msg('LIVE'), cover: msg('COVER'), karaoke: msg('KARAOKE'), lyrics: msg('LYRICS') }

/** Not the original recording. */
export const unofficial = (k: Kind) => k === 'cover' || k === 'karaoke'
