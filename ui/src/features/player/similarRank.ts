import type { LibraryTrack } from '../../shared/api'
import { rankPicks, type Candidate, type Taste, type Variety } from './score'

/**
 * "Then, similar songs" ranked by the whole queue (plan-v2, the owner 2026-11-14): a thin caller of the shared model in score.ts
 * (docs/recommendation.md). Pure: no network, no store; radio.ts gathers the candidates and the signals.
 */
export { VARIETIES, featuresOf, profileOf, type Candidate, type Taste, type Variety } from './score'

export function pickSimilar(candidates: Candidate[], queue: LibraryTrack[], index: number, taste: Taste, variety: Variety, max: number, rand: () => number = Math.random, library?: LibraryTrack[]): LibraryTrack[] {
  return rankPicks({ candidates, queue, index, taste, variety, max, rand, library })
}
