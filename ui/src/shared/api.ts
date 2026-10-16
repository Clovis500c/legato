import { invoke } from '@tauri-apps/api/core'

export type Source = 'spotify' | 'youtube' | 'local'
export type Service = Exclude<Source, 'local'>

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
}

export interface SyncReport {
  playlists: number
  matched: number
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
  player: (cmd: PlayerCommand) => invoke<void>('player', { cmd }),
  playerStatus: () => invoke<PlayerStatus>('player_status'),
  /** Raw JSON; validated by shared/theme/settings.sanitize. */
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: object) => invoke<void>('save_settings', { settings }),
}
