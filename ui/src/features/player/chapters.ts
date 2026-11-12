import { create } from 'zustand'
import type { Chapter } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import type { MenuEntry } from '../../shared/ui/ContextMenu'
import { positionNow } from './Progress'
import { usePlayer } from './store'

/** The playing book's chapters (`chaptersLoad.ts` fills them for an `.m4b` with a chapter list), else none. */
export const useChapters = create<{ list: Chapter[] }>(() => ({ list: [] }))

/** Index of the chapter at `ms` (the last one started), -1 before the first. */
export function chapterAt(list: { startMs: number }[], ms: number): number {
  let found = -1
  list.forEach((c, i) => {
    if (c.startMs <= ms) found = i
  })
  return found
}

/** When the chapter at `ms` ends: the next one's start, or null for the last one (the song's end). */
export const chapterEnd = (list: { startMs: number }[], ms: number): number | null => list[chapterAt(list, ms) + 1]?.startMs ?? null

/** Player menu: "Chapters" with each one to go to, the one playing checked; nothing for a song without. */
export function chaptersMenu(): MenuEntry {
  const { list } = useChapters.getState()
  if (!list.length) return false
  const at = chapterAt(list, positionNow())
  return { label: tr('Chapters'), items: list.map((c, i) => ({ label: `${formatDuration(c.startMs) || '0:00'}  ${c.title || tr('Chapter {n}', { n: i + 1 })}`, checked: i === at, onSelect: () => usePlayer.getState().seek(c.startMs) })) }
}
