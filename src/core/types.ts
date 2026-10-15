export type Source = 'spotify' | 'youtube' | 'local'

/** Morceau commun à tous les services. `ids` = identifiant du même morceau chez chaque source. */
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

/** Un service musical. Chaque utilisateur connecte son propre compte. */
export interface Connector {
  readonly source: Source
  isConnected(): boolean
  connect(): Promise<void>
  listPlaylists(): Promise<PlaylistRef[]>
  getPlaylistTracks(playlistId: string): Promise<Track[]>
  search(query: string): Promise<Track[]>
  /** Retrouve `track` sur ce service, ou null. */
  resolve(track: Track): Promise<Track | null>
  /** Crée une playlist et renvoie son id. Les morceaux sans id pour ce service sont ignorés. */
  writePlaylist(name: string, tracks: Track[]): Promise<string>
}

/** Stockage clé/valeur des secrets (safeStorage dans Electron, Map dans les tests). */
export interface SecretStore {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}
