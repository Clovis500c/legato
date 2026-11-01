import type { PlaylistFolder } from '../../shared/theme/theme'

/** A row of Your library's playlists: a playlist (depth 1 inside an open folder), or a folder. */
export type PlaylistRow<P> = { kind: 'playlist'; p: P; pinned: boolean; depth: 0 | 1 } | { kind: 'folder'; folder: PlaylistFolder; count: number }

/**
 * Your library's playlists as rows, each part in the order picked: pinned ones first (as pinned), then the folders, each
 * followed by its playlists when open, then the others. A pinned playlist shows once, on top, even when in a folder.
 */
export function arrange<P>(shown: P[], keyOf: (p: P) => string, pinned: string[], folders: PlaylistFolder[]): PlaylistRow<P>[] {
  const byKey = new Map(shown.map((p) => [keyOf(p), p]))
  const pins = new Set(pinned)
  const rows: PlaylistRow<P>[] = pinned.flatMap((k) => {
    const p = byKey.get(k)
    return p ? [{ kind: 'playlist' as const, p, pinned: true, depth: 0 as const }] : []
  })
  const filed = new Set<string>()
  for (const folder of folders) {
    const keys = new Set(folder.keys)
    const inside = shown.filter((p) => keys.has(keyOf(p)) && !pins.has(keyOf(p)))
    folder.keys.forEach((k) => filed.add(k))
    rows.push({ kind: 'folder', folder, count: inside.length })
    if (folder.open) rows.push(...inside.map((p) => ({ kind: 'playlist' as const, p, pinned: false, depth: 1 as const })))
  }
  for (const p of shown) if (!pins.has(keyOf(p)) && !filed.has(keyOf(p))) rows.push({ kind: 'playlist', p, pinned: false, depth: 0 })
  return rows
}

/** Pinned, or not any more: a new pin goes under the others. */
export const togglePin = (pinned: string[], key: string) => (pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key])

/** The playlist goes into the folder (out of any other; the folder opens to show it), or out of every folder (null). */
export function moveToFolder(folders: PlaylistFolder[], key: string, id: string | null): PlaylistFolder[] {
  return folders.map((f) => (f.id === id ? { ...f, keys: [...f.keys.filter((k) => k !== key), key], open: true } : { ...f, keys: f.keys.filter((k) => k !== key) }))
}

/** A new folder, open, at the end; holding `key` when given (taken out of any other). */
export function addFolder(folders: PlaylistFolder[], name: string, key?: string, id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): PlaylistFolder[] {
  const out = [...folders, { id, name, keys: [], open: true }]
  return key ? moveToFolder(out, key, id) : out
}
