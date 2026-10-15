import type { Track } from './types'

/** YouTube clip often has intro/outro audio lacks. Allow slack. */
const DURATION_TOLERANCE_MS = 10_000

const BRACKET_NOISE =
  /[([][^)\]]*\b(?:feat|ft|with|official|lyrics?|audio|video|remaster(?:ed)?|hd|hq|explicit|clean|visuali[sz]er|mv)\b[^)\]]*[)\]]/gi

/** Comparable form: lowercase, no accents, no "(Official Video)", no "feat.", no punctuation. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(BRACKET_NOISE, ' ')
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?\b.*$/, '')
    .replace(/\s(?:feat|ft)\.?\s.*$/, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** First credited artist, normalized ("A, B & C feat. D" → "a"). */
export function primaryArtist(artist: string): string {
  return normalize(artist.split(/,|&|;|\/|\s(?:feat|ft)\.?\s|\sx\s|\svs\.?\s/i)[0])
}

export function matchKey(t: Pick<Track, 'title' | 'artist'>): string {
  return `${normalize(t.title)}|${primaryArtist(t.artist)}`
}

function artistsOverlap(a: string, b: string): boolean {
  const pa = primaryArtist(a)
  const pb = primaryArtist(b)
  if (!pa || !pb) return false
  return ` ${normalize(a)} `.includes(` ${pb} `) || ` ${normalize(b)} `.includes(` ${pa} `)
}

/** Same recording? ISRC first (different ISRC = different recording), else title + artist + duration. */
export function sameTrack(a: Track, b: Track): boolean {
  for (const [source, id] of Object.entries(a.ids)) {
    if (id && b.ids[source as keyof Track['ids']] === id) return true
  }
  if (a.isrc && b.isrc) return a.isrc.toUpperCase() === b.isrc.toUpperCase()
  if (normalize(a.title) !== normalize(b.title) || !artistsOverlap(a.artist, b.artist)) return false
  if (a.durationMs == null || b.durationMs == null) return true
  return Math.abs(a.durationMs - b.durationMs) <= DURATION_TOLERANCE_MS
}

/** Best candidate: exact ISRC first, then fuzzy. */
export function bestMatch(track: Track, candidates: Track[]): Track | null {
  const isrc = track.isrc?.toUpperCase()
  return (
    (isrc && candidates.find((c) => c.isrc?.toUpperCase() === isrc)) ||
    candidates.find((c) => sameTrack(track, c)) ||
    null
  )
}

/** Merge two views of same track. `a` wins on filled fields. */
export function mergeTracks(a: Track, b: Track): Track {
  return {
    title: a.title,
    artist: a.artist,
    album: a.album ?? b.album,
    durationMs: a.durationMs ?? b.durationMs,
    isrc: a.isrc ?? b.isrc,
    ids: { ...b.ids, ...a.ids },
  }
}
