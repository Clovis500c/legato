import type { Library } from './library'
import { mergeTracks } from './match'
import type { Connector } from './types'

export interface SyncReport {
  playlists: number
  matched: number
  errors: string[]
}

/** Import every playlist of connected services, then link tracks missing on `target` (e.g. YouTube → Spotify). */
export async function sync(lib: Library, connectors: Connector[], target?: Connector): Promise<SyncReport> {
  const report: SyncReport = { playlists: 0, matched: 0, errors: [] }
  const connected = connectors.filter((c) => c.isConnected())
  for (const c of connected) {
    try {
      for (const p of await c.listPlaylists()) {
        try {
          lib.savePlaylist(c.source, p.id, p.name, await c.getPlaylistTracks(p.id))
          report.playlists++
        } catch (e) {
          report.errors.push(`${c.source} « ${p.name} » : ${(e as Error).message}`)
        }
      }
    } catch (e) {
      report.errors.push(`${c.source} : ${(e as Error).message}`)
    }
  }
  if (!target?.isConnected()) return report
  // shortcut: unmatched tracks re-searched every sync, add "last tried" column if rate limits bite.
  for (const t of lib.tracks().filter((t) => !t.ids[target.source])) {
    try {
      const hit = await target.resolve(t)
      if (hit) {
        lib.upsertTrack(mergeTracks(t, hit))
        report.matched++
      }
    } catch (e) {
      report.errors.push(`match « ${t.title} » : ${(e as Error).message}`)
    }
  }
  return report
}
