import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { primaryArtist } from './filter'

/** Words that make another version, not a copy: a live take and the studio one both stay. */
const VERSION = /\b(live|remix|mix|edit|acoustic|unplugged|instrumental|karaoke|cover|slowed|reverb|sped up|nightcore|demo|extended|version|remaster(?:ed)?|8d|bass boosted)\b/g
const IS_VERSION = new RegExp(VERSION.source)
/** Packaging only: the same song with it or not. */
const NOISE = /[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|clip|explicit|clean|feat\.?|ft\.?|with)\b[^)\]]*)[)\]]/g

/** Same song by the same artist: title without packaging, plus its version words. */
function key(t: LibraryTrack): string {
  const title = fold(t.title).replace(NOISE, ' ')
  const tags = [...new Set(title.match(VERSION) ?? [])].sort().join('+')
  const base = title
    .replace(/[([][^)\]]*[)\]]/g, (m) => (IS_VERSION.test(m) ? m : ' '))
    .replace(/\s(?:feat|ft)\.?\s.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return `${base.replace(VERSION, '').replace(/\s+/g, ' ').trim()}|${fold(primaryArtist(t.artist))}|${tags}`
}

/** Groups of two or more songs that look like the same one (biggest first). */
export function duplicateGroups(tracks: LibraryTrack[]): LibraryTrack[][] {
  const groups = new Map<string, LibraryTrack[]>()
  for (const t of tracks) {
    const k = key(t)
    if (k.startsWith('|')) continue
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)
}

/** Which copy to keep: most plays, then most sources, then an album, then the oldest. */
export function bestCopy(group: LibraryTrack[], stats: Record<number, [number, number]>): LibraryTrack {
  const score = (t: LibraryTrack) => [stats[t.id]?.[0] ?? 0, Object.keys(t.ids).length, t.album ? 1 : 0, -t.added]
  return [...group].sort((a, b) => {
    const [x, y] = [score(a), score(b)]
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]
    return 0
  })[0]
}

/** Later rows of a song already higher in the playlist. */
export function repeatedRows(order: number[]): number[] {
  const seen = new Set<number>()
  return order.flatMap((id, i) => (seen.has(id) ? [i] : (seen.add(id), [])))
}
