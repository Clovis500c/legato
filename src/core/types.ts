export type Source = 'spotify' | 'youtube' | 'local'

/** Common track model. `ids` = same track id per source. */
export interface Track {
  title: string
  artist: string
  album?: string
  durationMs?: number
  isrc?: string
  ids: Partial<Record<Source, string>>
}

export interface PlaylistRef {
  id: string
  name: string
}

/** Music service. Each user connects own account. */
export interface Connector {
  readonly source: Source
  isConnected(): boolean
  connect(): Promise<void>
  listPlaylists(): Promise<PlaylistRef[]>
  getPlaylistTracks(playlistId: string): Promise<Track[]>
  search(query: string): Promise<Track[]>
  /** Find `track` on this service, or null. */
  resolve(track: Track): Promise<Track | null>
  /** Create playlist, return id. Tracks without id here skipped. */
  writePlaylist(name: string, tracks: Track[]): Promise<string>
}

/** Secret key/value store. safeStorage in Electron, Map in tests. */
export interface SecretStore {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}
