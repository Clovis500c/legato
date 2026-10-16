import { invoke } from '@tauri-apps/api/core'
import type { Box } from './artbox'
import type { SystemAccent } from './theme/theme'

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
  /** Cover art URL; shown through the app's image cache (shared/art). */
  art?: string | null
}

export interface LibraryTrack extends Track {
  id: number
  /** "Date added" rank: order the app met the track (services give no dates). */
  added: number
}

/** Stable identity of a playlist: service + its id there (survives re-imports); own playlists by row id. */
export const playlistKey = (p: Pick<LibraryPlaylist, 'id' | 'source' | 'sourceId' | 'custom'>) => (p.custom ? `custom:${p.id}` : `${p.source}:${p.sourceId}`)

/** connectors discord::Presence. buttons = [label, https url], 2 at most. */
export interface Presence {
  title: string
  artist: string
  album: string | null
  art: string | null
  buttons: [string, string][]
  playing: boolean
  positionMs: number
  durationMs: number | null
  status: 'name' | 'artist' | 'song'
}

export interface LibraryPlaylist {
  id: number
  source: Source
  sourceId: string
  name: string
  trackCount: number
  /** Made in the app: editable. */
  custom: boolean
  /** Service order = newest first (Liked Music). */
  newestFirst: boolean
}

/** crates/core cache::Stats, per cache (Settings › About). */
export interface CacheStat {
  hits: number
  misses: number
  entries: number
  bytes: number
}
export type CacheStats = Record<'library' | 'playlists' | 'mixes' | 'stats' | 'images', CacheStat>

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
  errors: string[]
}

export interface SourceStatus {
  configured: boolean
  connected: boolean
}

export interface Credentials {
  spotifyClientId?: string
}

/** crates/connectors ytmusic::Account: a Google account (authuser) or one of its channels (pageId). */
export interface YtmAccount {
  name: string
  handle: string | null
  email: string | null
  authuser: number
  pageId: string | null
  /** Profile picture URL (still or animated). */
  photo?: string | null
}

export const accountKey = (a: YtmAccount) => (a.pageId ? `${a.authuser}:${a.pageId}` : String(a.authuser))

/** crates/player Command. */
export type PlayerCommand =
  | { type: 'play'; paths: string[]; start: number }
  | { type: 'toggle' | 'next' | 'prev' | 'stop' | 'truncate' }
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
}

/** src-tauri share_playlist. qr = [size, row-major "0"/"1"], null when too big. */
export interface ShareCode {
  link: string
  qr: [number, string] | null
  tracks: number
  bytes: number
}

export interface SharePreview {
  name: string
  tracks: number
  /** Already in this library. */
  known: number
}

/** crates/core history::Play. startedAt = unix seconds. */
export interface Play {
  trackId: number
  startedAt: number
  listenedMs: number
  completed: boolean
}

/** crates/core mixes::Mix. */
export interface Mix {
  id: string
  title: string
  reason: string
  trackIds: number[]
  /** Section on the Mixes page. */
  kind: 'daily' | 'moment' | 'favorites' | 'explore'
}

/** crates/connectors spotify::PlayerCommand (Spotify Connect). */
export type SpotifyCommand = { type: 'play'; trackId: string } | { type: 'pause' | 'resume' | 'next' | 'previous' } | { type: 'seek'; ms: number } | { type: 'volume'; percent: number }

export interface SpotifyPlayback {
  playing: boolean
  positionMs: number
  durationMs: number | null
  trackId: string | null
  device: string | null
}

/** src-tauri export_youtube. */
export interface ExportReport {
  url: string
  added: number
  already: number
  noYoutube: number
}

/** src-tauri NearbyState. */
export type NearbyState = { state: 'idle' } | { state: 'waiting'; code: string } | { state: 'sent' } | { state: 'failed'; error: string }

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
  /** Real covers for Apple tracks (1 batched lookup). Returns tracks updated. */
  backfillArt: (country: string) => invoke<number>('backfill_art', { country }),
  /** Apple 30 s preview into the local engine. Returns the Apple Music page. */
  playPreview: (id: string, country: string) => invoke<string>('play_preview', { id, country }),
  sharePlaylist: (id: number) => invoke<ShareCode>('share_playlist', { id }),
  /** Parses a link or QR text; counts tracks already in the library. */
  sharePreview: (code: string) => invoke<SharePreview>('share_preview', { code }),
  /** QR text from a PNG / JPEG file. */
  shareReadImage: (path: string) => invoke<string>('share_read_image', { path }),
  shareImport: (code: string, country: string) => invoke<{ playlistId: number; added: number; missing: number }>('share_import', { code, country }),
  /** Offers the playlist on the local network; returns the 6-digit code. */
  nearbySend: (id: number) => invoke<string>('nearby_send', { id }),
  nearbyStatus: () => invoke<NearbyState>('nearby_status'),
  nearbyStop: () => invoke<void>('nearby_stop'),
  /** Finds the sender on the network; returns a share link for the import dialog. */
  nearbyReceive: (code: string) => invoke<string>('nearby_receive', { code }),
  recordPlay: (play: Play) => invoke<void>('record_play', { play }),
  /** Today's mixes, from local history and custom playlists. */
  mixes: () => invoke<Mix[]>('mixes', { utcOffset: -new Date().getTimezoneOffset() * 60 }),
  /** less = ranked lower in mixes, never = left out, null = back to normal. */
  setTrackPref: (trackId: number, pref: 'less' | 'never' | null) => invoke<void>('set_track_pref', { trackId, pref }),
  clearHistory: () => invoke<void>('clear_history'),
  /** Private YouTube playlist; same one updated on later exports. */
  exportYoutube: (id: number) => invoke<ExportReport>('export_youtube', { id }),
  spotifyPlayer: (cmd: SpotifyCommand) => invoke<void>('spotify_player', { cmd }),
  /** null = nothing playing on any Spotify device. */
  spotifyPlayback: () => invoke<SpotifyPlayback | null>('spotify_playback'),
  /** Opens music.youtube.com to sign in (no keys). */
  ytmSignIn: (add = false) => invoke<void>('ytm_sign_in', { add }),
  ytmSignOut: () => invoke<void>('ytm_sign_out'),
  /** Public Spotify playlist / album link → imported playlist (no account); tracks get their YouTube version. */
  importSpotifyLink: (url: string) => invoke<{ playlistId: number; name: string; tracks: number; playable: number }>('import_spotify_link', { url }),
  /** Spotify's own web player in an app window (prototype). */
  spotifyWebOpen: () => invoke<void>('spotify_web_open'),
  /** Signed in to the Spotify web player. */
  spotifyWebStatus: () => invoke<boolean>('spotify_web_status'),
  /** Every account in the Google session + keys of those synced. */
  ytmAccounts: () => invoke<{ signedIn: boolean; accounts: YtmAccount[]; picked: string[] }>('ytm_accounts'),
  /** Synced accounts, in order (first = exports). */
  setYtmAccounts: (accounts: YtmAccount[]) => invoke<void>('set_ytm_accounts', { accounts }),
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
  /** Windows accent (light / dark theme variants); null off Windows. */
  systemAccent: () => invoke<SystemAccent | null>('system_accent'),
  restartApp: () => invoke<void>('restart_app'),
  /** Other uploads of the same song when the video refuses embedding (101 / 150), best first. */
  alternativeVideos: (trackId: number, exclude: string[]) => invoke<string[]>('alternative_videos', { trackId, exclude }),
  /** Track id → [listens, last start]: Most played / Recently played. */
  playStats: () => invoke<Record<number, [number, number]>>('play_stats'),
  cacheStats: () => invoke<CacheStats>('cache_stats'),
  /** Track ids of every playlist, in order (covers). */
  playlistOrders: () => invoke<Record<number, number[]>>('playlist_orders'),
  /** Picked image copied into the app; returns its name for the art scheme (cover/<name>). */
  saveCover: (playlistId: number, path: string) => invoke<string>('save_cover', { playlistId, path }),
  /** Track cover to a file (png/jpg). source = art scheme path, crop = fractions (video bars cut). Returns the file written. */
  exportCover: (source: string, crop: Box | null, path: string) => invoke<string>('export_cover', { source, crop, path }),
  /** Discord Rich Presence add-on: track shown under the user's Discord application (null = nothing). */
  discordPresence: (clientId: string, presence: Presence | null) => invoke<void>('discord_presence', { clientId, presence }),
  discordOff: () => invoke<void>('discord_off'),
  discordStatus: () => invoke<{ connected: boolean; error: string | null }>('discord_status'),
  /** Imported YouTube Music playlist: added on YouTube (Liked Music = like), then locally. */
  addToYoutube: (id: number, trackIds: number[]) => invoke<{ added: number; already: number; noYoutube: number; refused: string | null }>('add_to_youtube', { id, trackIds }),
  /** Raw JSON; validated by features/player/session. */
  loadSession: () => invoke<unknown>('load_session'),
  saveSession: (session: object) => invoke<void>('save_session', { session }),
  /** Windows media panel; null = nothing playing. Cover: local file's (trackId), else `art` URL. */
  mediaUpdate: (now: MediaNow | null, trackId: number | null, art: string | null) => invoke<void>('media_update', { now, trackId, art }),
}

/** src-tauri media::NowPlaying. */
export interface MediaNow {
  title: string
  artist: string
  album: string | null
  playing: boolean
  positionMs: number
  /** Null = unknown yet: no seek bar. */
  durationMs: number | null
}
