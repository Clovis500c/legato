import type { LibraryTrack } from '../../shared/api'
import type { Candidate } from './score'

/** The YouTube songs a pick is made around: the last `max` distinct ones of the queue up to the playing one, latest first (docs/recommendation.md, slice 1). */
export function seedsOf(queue: readonly LibraryTrack[], index: number, max: number): LibraryTrack[] {
  const seen = new Set<string>()
  const out: LibraryTrack[] = []
  for (let i = Math.min(index, queue.length - 1); i >= 0 && out.length < max; i--) {
    const video = queue[i].ids.youtube
    if (video && !seen.has(video)) {
      seen.add(video)
      out.push(queue[i])
    }
  }
  return out
}

/** Several radios as one pool: a song in more than one gets a vote each (the crowd's "played together") and keeps its best place. */
export function mergeRadios(radios: readonly (readonly LibraryTrack[])[]): Candidate[] {
  const by = new Map<string, Candidate>()
  for (const radio of radios) {
    const once = new Set<string>()
    radio.forEach((track, rank) => {
      const key = track.ids.youtube ?? `#${track.id}`
      if (once.has(key)) return
      once.add(key)
      const have = by.get(key)
      if (have) by.set(key, { track: have.track, rank: Math.min(have.rank ?? rank, rank), votes: (have.votes ?? 1) + 1 })
      else by.set(key, { track, rank, votes: 1 })
    })
  }
  return [...by.values()]
}

/**
 * The radios of these videos, one request each in order (YouTube Music's own answers, through the app's cache; signed out they
 * are the public ones), merged. A refusal ends the crowd for this pick: nothing from it, no further request, never retried here.
 */
export async function crowdOf(videos: readonly string[], ask: (video: string) => Promise<LibraryTrack[]>): Promise<Candidate[]> {
  const radios: LibraryTrack[][] = []
  for (const video of videos) {
    try {
      radios.push(await ask(video))
    } catch {
      return []
    }
  }
  return mergeRadios(radios)
}

/** Related artists whose top songs join a mix from a song (docs/recommendation.md, slice 4). */
const FANS = 2
/** Top songs taken from each, and where they stand after a radio's first places. */
const FANS_SONGS = 5
const FANS_FROM = 5

/**
 * The top songs of the first `FANS` artists YouTube Music says go with the seed's ("Fans might also like"), one request each: candidates
 * placed after the radios' best, one vote. No related artist: no request. A refusal: nothing from them and no further request.
 */
export async function fansOf(related: readonly string[], askTop: (artist: string) => Promise<LibraryTrack[]>): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const name of related.slice(0, FANS)) {
    try {
      ;(await askTop(name)).slice(0, FANS_SONGS).forEach((track, i) => out.push({ track, rank: FANS_FROM + i, votes: 1 }))
    } catch {
      return []
    }
  }
  return out
}
