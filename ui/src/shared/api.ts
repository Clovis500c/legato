import { invoke } from '@tauri-apps/api/core'

export type Source = 'spotify' | 'youtube' | 'local' | 'apple'
/** Services with an account to connect. */
export type Service = 'spotify' | 'youtube'

// shortcut: hand-mirrored from crates/core (model.rs, library.rs, sync.rs). Generate with ts-rs/specta when API grows.
export interface Track {
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  isrc: string | null
  ids: Partial<Record<Source, string>>
}

export interface LibraryTrack extends Track {
  id: number
}

export interface LibraryPlaylist {
  id: number
  source: Source
  sourceId: string
  name: string
  trackCount: number
  /** Made in the app: editable. */
  custom: boolean
}

/** crates/core PlaylistEdit. */
export type PlaylistEdit =
  | { type: 'create'; name: string }
  | { type: 'rename'; id: number; name: string }
  | { type: 'delete'; id: number }
  | { type: 'add'; id: number; trackIds: number[] }
  | { type: 'remove'; id: number; position: number }
  | { type: 'move'; id: number; from: number; to: number }
  | { type: 'duplicate'; id: number; name: string }

export interface SyncReport {
  playlists: number
  matched: number
  errors: string[]
}

/** Merged catalog hit (src-tauri search_catalogs). */
export interface SearchHit extends Track {
  libraryId: number | null
}

export interface SearchResults {
  hits: SearchHit[]
  youtubeSearchesLeft: number
  errors: string[]
}

export interface SourceStatus {
  configured: boolean
  connected: boolean
}

export interface Credentials {
  spotifyClientId?: string
  youtubeClientId?: string
  youtubeClientSecret?: string
}

/** crates/player Command. */
export type PlayerCommand =
  | { type: 'play'; paths: string[]; start: number }
  | { type: 'toggle' | 'next' | 'prev' | 'stop' }
  | { type: 'seek'; ms: number }
  | { type: 'volume'; value: number }

export interface PlayerStatus {
  path: string | null
  positionMs: number
  durationMs: number | null
  paused: boolean
  upcoming: string[]
  error: string | null
  /** Queue ran out on its own. */
  ended: boolean
}

/** src-tauri find_versions. */
export interface FindReport {
  found: number
  missing: number
  youtubeSearchesLeft: number
}

/** Typed wrappers over Tauri commands (src-tauri/src/lib.rs). Rejections = error string. */
export const api = {
  sourcesStatus: async () =>
    Object.fromEntries(await invoke<[Service, SourceStatus][]>('sources_status')) as Record<Service, SourceStatus>,
  connect: (source: Service, credentials: Credentials) => invoke<void>('connect', { source, credentials }),
  disconnect: (source: Service) => invoke<void>('disconnect', { source }),
  sync: () => invoke<SyncReport>('sync_all'),
  library: () => invoke<{ tracks: LibraryTrack[]; playlists: LibraryPlaylist[] }>('library'),
  playlistTracks: (id: number) => invoke<LibraryTrack[]>('playlist_tracks', { id }),
  /** New playlist id for create / duplicate. */
  editPlaylist: (edit: PlaylistEdit) => invoke<number | null>('edit_playlist', { edit }),
  /** Pasted YouTube link → library. Returns "Artist – Title". */
  addLink: (url: string) => invoke<string>('add_link', { url }),
  searchCatalogs: (query: string, country: string) => invoke<SearchResults>('search_catalogs', { query, country }),
  /** Returns library row id. Finds a YouTube version when missing (1 search). */
  addTrack: (track: Track) => invoke<number>('add_track', { track }),
  /** YouTube versions for tracks with no full source (1 search each, daily budget). */
  findVersions: (ids: number[]) => invoke<FindReport>('find_versions', { ids }),
  /** Apple 30 s preview into the local engine. Returns the Apple Music page. */
  playPreview: (id: string, country: string) => invoke<string>('play_preview', { id, country }),
  localFolders: () => invoke<string[]>('local_folders'),
  /** Saves folders, rescans. Returns local file count. */
  setLocalFolders: (folders: string[]) => invoke<number>('set_local_folders', { folders }),
  rescanLocal: () => invoke<number>('rescan_local'),
  player: (cmd: PlayerCommand) => invoke<void>('player', { cmd }),
  playerStatus: () => invoke<PlayerStatus>('player_status'),
  /** Raw JSON; validated by shared/theme/settings.sanitize. */
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: object) => invoke<void>('save_settings', { settings }),
  shieldStatus: () => invoke<{ enabled: boolean; blocked: number }>('shield_status'),
  setShield: (enabled: boolean) => invoke<void>('set_shield', { enabled }),
  restartApp: () => invoke<void>('restart_app'),
}
