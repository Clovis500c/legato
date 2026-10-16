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

export const kindLabel: Record<Exclude<Kind, null>, string> = { clip: 'CLIP', live: 'LIVE', cover: 'REPRISE', karaoke: 'KARAOKÉ', lyrics: 'PAROLES' }

/** Not the original recording. */
export const unofficial = (k: Kind) => k === 'cover' || k === 'karaoke'
