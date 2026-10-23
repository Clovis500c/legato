import type { AlbumInfo, LibraryTrack, Track } from '../../shared/api'

export type AlbumRow = { disc: number; number: number } & ({ mine: LibraryTrack } | { missing: Track })

/**
 * Album page in the catalog's order: your songs where they belong, the ones you don't have in between (to add), then
 * your songs the catalog doesn't list (bonus tracks, other versions). `ordered` = your songs in that order (Play all).
 */
export function albumRows(info: AlbumInfo, shown: LibraryTrack[]): { rows: AlbumRow[]; extras: LibraryTrack[]; ordered: LibraryTrack[]; discs: number } {
  const byId = new Map(shown.map((t) => [t.id, t]))
  const rows: AlbumRow[] = info.slots.map((s) => {
    const mine = s.libraryId === null ? undefined : byId.get(s.libraryId)
    return mine ? { disc: s.disc, number: s.number, mine } : { disc: s.disc, number: s.number, missing: s.track }
  })
  const placed = new Set(rows.flatMap((r) => ('mine' in r ? [r.mine.id] : [])))
  const extras = shown.filter((t) => !placed.has(t.id))
  const ordered = [...rows.flatMap((r) => ('mine' in r ? [r.mine] : [])), ...extras]
  return { rows, extras, ordered, discs: new Set(info.slots.map((s) => s.disc)).size }
}
