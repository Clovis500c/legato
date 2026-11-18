import type { Chapter, LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'

/**
 * A long video split by its chapters (Settings › Playback › Chapters of long YouTube videos, the owner's ask of 2026-11-13):
 * each part a row of Up next over the same video. Times are the video's own (ms); `endMs` null = the video's end. Pure.
 */
export interface Part {
  startMs: number
  endMs: number | null
}

/** The part a queue row plays, none for a whole song. */
export const partOf = (t: LibraryTrack | undefined): Part | undefined => (t as { part?: Part } | undefined)?.part

/**
 * The video's row once per chapter: the chapter's title, the video's artist and source, the part's length. Chapters sorted,
 * once each, inside the video; the first part holds the start (a description's first timestamp may come late). Fewer than
 * two, or the video's length unknown: none, it plays whole. Ids are the caller's (queue rows of their own).
 */
export function partRows(video: LibraryTrack, chapters: readonly Chapter[], videoMs: number): LibraryTrack[] {
  if (!(videoMs > 0)) return []
  const starts: Chapter[] = []
  for (const c of [...chapters].sort((a, b) => a.startMs - b.startMs)) {
    if (c.startMs >= 0 && c.startMs < videoMs && c.startMs !== starts.at(-1)?.startMs) starts.push(c)
  }
  if (starts.length < 2) return []
  return starts.map((c, i) => {
    const startMs = i === 0 ? 0 : c.startMs
    const endMs = starts[i + 1]?.startMs ?? null
    const part: Part = { startMs, endMs }
    return { ...video, title: c.title || tr('Chapter {n}', { n: i + 1 }), durationMs: (endMs ?? videoMs) - startMs, part } as LibraryTrack
  })
}

/** The row of `video` in the play order whose part holds `ms`, else -1 (a part taken out of Up next is not there). */
export function partIn(list: readonly LibraryTrack[], order: readonly number[], video: string, ms: number): number {
  for (const i of order) {
    const p = partOf(list[i])
    if (p && list[i].ids.youtube === video && ms >= p.startMs && (p.endMs === null || ms < p.endMs)) return i
  }
  return -1
}

/**
 * A play order with each video's parts together and in time order, where the first of them came (a shuffle mixes songs, never
 * a set's parts). Rows not in `order` stay out.
 */
export function keepParts(order: readonly number[], list: readonly LibraryTrack[]): number[] {
  const groups = new Map<string, number[]>()
  for (const i of order) {
    const video = partOf(list[i]) && list[i].ids.youtube
    if (video) groups.set(video, [...(groups.get(video) ?? []), i])
  }
  if (!groups.size) return [...order]
  const out: number[] = []
  for (const i of order) {
    const video = partOf(list[i]) && list[i].ids.youtube
    if (!video) out.push(i)
    else if (groups.has(video)) {
      out.push(...groups.get(video)!.sort((a, b) => partOf(list[a])!.startMs - partOf(list[b])!.startMs))
      groups.delete(video)
    }
  }
  return out
}
