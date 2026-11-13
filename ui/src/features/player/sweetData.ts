import type { SongEnds } from '../../shared/api'
import type { Ends } from './sweet'

// What the files' earlier measures say of the ends of the songs near the one playing (`sweetLoad.ts` fills it; the store
// reads it, so it holds no import of the store).
const known = new Map<number, SongEnds>()
const KEEP = 200

export function remember(list: SongEnds[]) {
  for (const e of list) {
    known.delete(e.trackId)
    known.set(e.trackId, e)
  }
  while (known.size > KEEP) known.delete(known.keys().next().value as number)
}

/** A song's tempo (the library's) with what is known of its ends. */
export function endsOf(t: { id: number; bpm?: number } | undefined): Ends | undefined {
  if (!t) return undefined
  const e = known.get(t.id)
  return { bpm: t.bpm, tailMs: e?.tailMs, lufs: e?.lufs ?? undefined }
}
