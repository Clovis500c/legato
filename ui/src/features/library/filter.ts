import type { LibraryTrack, Source } from '../../shared/api'
import { fold } from '../../shared/format'

export type Filter = 'all' | Source | 'unlinked'

const sourceCount = (t: LibraryTrack) => Object.keys(t.ids).length

/** Unlinked = known on one service only. */
export function filterTracks(tracks: LibraryTrack[], query: string, filter: Filter): LibraryTrack[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  return tracks.filter((t) => {
    if (filter === 'unlinked' ? sourceCount(t) > 1 : filter !== 'all' && !t.ids[filter]) return false
    if (!words.length) return true
    const hay = fold(`${t.title} ${t.artist} ${t.album ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
}

export function libraryStats(tracks: LibraryTrack[]) {
  const perSource: Record<Source, number> = { spotify: 0, youtube: 0, local: 0 }
  let linked = 0
  for (const t of tracks) {
    for (const s of Object.keys(t.ids) as Source[]) perSource[s]++
    if (sourceCount(t) > 1) linked++
  }
  return {
    total: tracks.length,
    perSource,
    sources: Object.values(perSource).filter(Boolean).length,
    unlinked: tracks.length - linked,
    linkedPct: tracks.length ? Math.round((linked / tracks.length) * 100) : 0,
  }
}
