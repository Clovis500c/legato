import type { LibraryChanges, LibraryPlaylist, LibraryTrack } from '../shared/api'

// What Rust says changed (library_changes) into the store's copy of the library, as a whole read would have it: rows
// where its ORDER BY puts them, same objects (and arrays) where nothing changed so memoized lists stay as they are.

/** SQLite's NOCASE: ASCII letters folded, then code point order (UTF-8 bytes). */
export function nocase(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i)
    let y = b.charCodeAt(i)
    if (x === y) continue
    if (x >= 65 && x <= 90) x += 32
    if (y >= 65 && y <= 90) y += 32
    if (x === y) continue
    // UTF-16 to code point order: surrogates (past U+FFFF) after U+E000–U+FFFF.
    if (x >= 0xd800 && y >= 0xd800) {
      x += x >= 0xe000 ? -0x800 : 0x2000
      y += y >= 0xe000 ? -0x800 : 0x2000
    }
    return x - y
  }
  return a.length - b.length
}

// crates/core library.rs track_rows / playlist_rows.
const trackOrder = (a: LibraryTrack, b: LibraryTrack) => nocase(a.artist, b.artist) || nocase(a.title, b.title) || a.id - b.id
const playlistOrder = (a: LibraryPlaylist, b: LibraryPlaylist) => nocase(a.name, b.name) || a.id - b.id

/** `list` (sorted by `order`) with `rows` in and `gone` out. A row sent again unchanged keeps its old object. */
function merge<T extends { id: number }>(list: T[], rows: T[], gone: number[], order: (a: T, b: T) => number): T[] {
  if (!rows.length && !gone.length) return list
  const drop = new Set(gone)
  const fresh = new Map(rows.map((r) => [r.id, r]))
  const kept: T[] = []
  for (const r of list) {
    const f = fresh.get(r.id)
    if (drop.has(r.id) || (f && JSON.stringify(f) !== JSON.stringify(r))) continue
    fresh.delete(r.id)
    kept.push(r)
  }
  if (kept.length === list.length && !fresh.size) return list
  // New and changed rows, each where a whole read puts it.
  const add = [...fresh.values()].sort(order)
  const out: T[] = []
  let i = 0
  for (const r of kept) {
    while (i < add.length && order(add[i], r) < 0) out.push(add[i++])
    out.push(r)
  }
  return out.concat(add.slice(i))
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Whole reads leave empty playlists out of orders. */
function patchOrders(orders: Record<number, number[]>, c: LibraryChanges): Record<number, number[]> {
  let next: Record<number, number[]> | undefined
  const put = (id: number, ids: number[]) => {
    const old = orders[id]
    if (ids.length ? old && same(old, ids) : !old) return
    next ??= { ...orders }
    if (ids.length) next[id] = ids
    else delete next[id]
  }
  for (const [id, ids] of Object.entries(c.orders)) put(Number(id), ids)
  for (const id of c.playlistsGone) put(id, [])
  return next ?? orders
}

export interface LibraryLists {
  tracks: LibraryTrack[]
  playlists: LibraryPlaylist[]
  orders: Record<number, number[]>
}

export const patchLibrary = (s: LibraryLists, c: LibraryChanges): LibraryLists => ({
  tracks: merge(s.tracks, c.tracks, c.gone, trackOrder),
  playlists: merge(s.playlists, c.playlists, c.playlistsGone, playlistOrder),
  orders: patchOrders(s.orders, c),
})
