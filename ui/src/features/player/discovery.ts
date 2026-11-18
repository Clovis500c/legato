import type { LibraryTrack, Shelf } from '../../shared/api'
import { remoteTrack } from './store'
import type { Candidate } from './score'

/**
 * "New for you" (docs/recommendation.md, slice 5; signed in): the songs YouTube Music's Home shelves offer, each once in place order, left out
 * when the library holds that video already (they are for finding the new). Ranked afterwards by our score with the explore dose (rankPicks).
 */
export function discoveryCandidates(shelves: readonly Shelf[], library: readonly LibraryTrack[]): Candidate[] {
  const known = new Set(library.flatMap((t) => (t.ids.youtube ? [t.ids.youtube] : [])))
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const shelf of shelves)
    for (const it of shelf.items) {
      const video = it.track?.ids.youtube
      if (!it.track || !video || known.has(video) || seen.has(video)) continue
      seen.add(video)
      out.push({ track: remoteTrack(it.track), rank: out.length })
    }
  return out
}
