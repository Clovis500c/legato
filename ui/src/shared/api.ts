import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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
  /** Music or not (YouTube imports bring talks and games along). Absent = not looked at. */
  musicness?: Musicness
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
  /** Service order = newest first (new songs on top: Liked Music, most YouTube playlists). */
  newestFirst: boolean
  /** newestFirst set by hand (else learned from syncs). */
  orderManual: boolean
}

/** crates/connectors ytmusic::ListRef: a playlist / album page, or a radio. */
export type ListRef = { type: 'browse'; id: string } | { type: 'radio'; videoId: string | null; playlistId: string }

/** Card on YouTube Music's home: a song to play, or a list to open. */
export interface HomeItem {
  title: string
  subtitle: string
  art: string | null
  track: Track | null
  list: ListRef | null
}

export interface Shelf {
  title: string
  items: HomeItem[]
}

/** src-tauri update::Status: what the background updater is doing. */
export type UpdateState = { state: 'idle' | 'checking' | 'upToDate' } | { state: 'available'; version: string; notes: string | null } | { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string; notes: string | null } | { state: 'installing'; version: string } | { state: 'error'; message: string }
export type UpdateStatus = UpdateState & {
  current: string
  /** Unix seconds. */
  lastCheck: number | null
  lastUpdate: { from: string; to: string; at: number } | null
  /** First launch after an update. */
  justUpdated: boolean
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
  /** Every occurrence of a song. */
  | { type: 'removeTrack'; id: number; trackId: number }
  | { type: 'move'; id: number; from: number; to: number }
  | { type: 'duplicate'; id: number; name: string }
  /** Imported playlist: which end new songs land on. null = learned from syncs. */
  | { type: 'setOrder'; id: number; newestFirst: boolean | null }

export interface SyncReport {
  playlists: number
  matched: number
  errors: string[]
}

/** src-tauri ytwatch.rs. */
export interface WatchRect {
  x: number
  y: number
  width: number
  height: number
}
export type WatchCmd =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; percent: number }
  | { type: 'crop'; x: number; y: number; w: number; h: number }
  | { type: 'live'; on: boolean; adaptive: boolean; targetLufs: number; effects?: Effects }

/** crates/dsp control.rs: live processing settings of the native engine. */
export interface LiveSettings {
  adaptive: boolean
  targetLufs: number
}
/** crates/dsp effects.rs: Live Editor settings (numbers only; clamped by Rust and live.js). */
export interface Effects {
  on: boolean
  speed: number
  tempo: number
  pitch: number
  bass: number
  eq: [number, number, number, number, number]
  reverb: { mix: number; size: number; damping: number; predelayMs: number }
  echo: { mix: number; timeMs: number; feedback: number }
  space: { on: boolean; azimuth: number; elevation: number; distance: number; rotate: boolean; periodS: number; room: number }
  compress: number
  width: number
  balance: number
}

/** crates/core library.rs Edit: effects as JSON (parse with effects.ts cleanEffects). */
export interface Edit {
  id: number
  song: string | null
  name: string
  effects: string
  active: boolean
}

/** crates/dsp control.rs: what plays, as heard (LUFS, peak 0..1, Adaptive Sound gain in dB). */
export interface LiveLevels {
  /** Last 50 ms (beats). */
  fast: number
  momentary: number
  short: number
  peak: number
  gain: number
}
/** src-tauri speech.rs: why voice search heard nothing. */
export type VoiceMiss = 'speechOff' | 'micBlocked' | 'noMic' | 'silence' | 'unclear' | 'offline' | 'language' | 'canceled' | 'failed'
export type Heard = { kind: 'text'; text: string } | { kind: 'miss'; miss: VoiceMiss }

/** src-tauri detect_song: Music Detector outcome. */
export type DetectMiss = 'noToken' | 'noMic' | 'micBlocked' | 'micBusy' | 'silent' | 'canceled' | 'badToken' | 'limit' | 'offline' | 'failed'
export type Detection = { kind: 'found'; track: Track } | { kind: 'unknown' } | { kind: 'miss'; miss: DetectMiss; detail: string | null }

/** crates/core lyrics.rs. Lines synced (ms); empty = plain only. */
export interface Lyrics {
  lines: { ms: number; text: string }[]
  plain: string | null
  instrumental: boolean
  source: string
}

/** ytwatch.rs LiveReport (watch page). */
export interface LiveReport {
  attached?: boolean
  error?: string | null
  levels?: LiveLevels | null
}
export interface WatchReport {
  state?: number
  time?: number
  duration?: number
  videoId?: string
  /** Playability status when it can't play: UNPLAYABLE, LOGIN_REQUIRED, ERROR… */
  error?: string
  reason?: string
  click: boolean
  /** Muted, waiting for the app's volume. */
  ready: boolean
  /** The app's crop is applied. */
  cropped: boolean
}

/** crates/core musicness: notMusic results are hidden until asked. */
export type Musicness = 'music' | 'unsure' | 'notMusic'

export interface SearchHit extends Track {
  libraryId: number | null
  musicness: Musicness
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
  /** What title and reason are made of: the UI words them in its language (features/mixes/words.ts). */
  words: { slot?: 'morning' | 'afternoon' | 'evening' | 'night'; day?: number; number?: number; name?: string; names?: string[] }
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
  /** Every occurrence out of a playlist: custom here, YouTube Music on the account (owner only; Liked = unlike). */
  removeFromPlaylist: (id: number, trackId: number) => invoke<void>('remove_from_playlist', { id, trackId }),
  /** Out of the library and every playlist here; syncs and folder scans leave it out. */
  removeFromLibrary: (trackId: number) => invoke<void>('remove_from_library', { trackId }),
  /** Pasted YouTube link → library. Returns "Artist – Title". */
  addLink: (url: string) => invoke<string>('add_link', { url }),
  searchCatalogs: (query: string, country: string) => invoke<SearchResults>('search_catalogs', { query, country }),
  /** Returns library row id. Finds a YouTube version when missing (1 search). */
  addTrack: (track: Track) => invoke<number>('add_track', { track }),
  /** Search hit with its YouTube version (one search if missing), nothing written: play without adding. */
  resolveTrack: (track: Track) => invoke<Track>('resolve_track', { track }),
  ytmHome: () => invoke<Shelf[]>('ytm_home'),
  ytmList: (list: ListRef) => invoke<Track[]>('ytm_list', { list }),
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
  /** Live processing of local files (crates/dsp): applies from the next block, nothing restarts. */
  playerLive: (settings: LiveSettings) => invoke<void>('player_live', { settings }),
  /** Live Editor: a song's saved edits (key from effects.ts songKey), or the presets (null). */
  edits: (song: string | null) => invoke<Edit[]>('edits', { song }),
  saveEdit: (id: number | null, song: string | null, name: string, effects: Effects) => invoke<number>('save_edit', { id, song, name, effects }),
  deleteEdit: (id: number) => invoke<void>('delete_edit', { id }),
  activateEdit: (song: string, id: number | null) => invoke<void>('activate_edit', { song, id }),
  /** Live Editor: a local file's copy with the effects applied, as a new WAV (the original is only read). */
  exportEdit: (input: string, output: string, effects: Effects) => invoke<void>('export_edit', { input, output, effects }),
  exportStop: () => invoke<void>('export_stop'),
  /** Export progress, 0..1 (null: length unknown). */
  onExport: (cb: (progress: number | null) => void) => listen<number | null>('export', (e) => cb(e.payload)),
  /** Live Editor settings for the native engine. */
  playerEffects: (effects: Effects) => invoke<void>('player_effects', { effects }),
  /** What the native engine plays, as heard. */
  playerLevels: () => invoke<LiveLevels>('player_levels'),
  /** Voice search: one phrase through Windows' speech recognition. */
  voiceListen: () => invoke<Heard>('voice_listen'),
  voiceStop: () => invoke<void>('voice_stop'),
  /** Words heard so far. */
  onSpeech: (cb: (text: string) => void) => listen<string>('speech', (e) => cb(e.payload)),
  /** Music Detector: an AudD token is saved (keychain). */
  detectorStatus: () => invoke<boolean>('detector_status'),
  /** null forgets it. */
  setDetectorToken: (token: string | null) => invoke<void>('set_detector_token', { token }),
  /** Listens ~10 s through the microphone (memory only), AudD names the song. */
  detectSong: (market: string) => invoke<Detection>('detect_song', { market }),
  detectStop: () => invoke<void>('detect_stop'),
  /** While listening: seconds so far, microphone level 0..1. */
  onDetect: (cb: (seconds: number, level: number) => void) => listen<[number, number]>('detect', (e) => cb(e.payload[0], e.payload[1])),
  /** Lyrics of a song (LRCLIB, then YouTube Music's own when signed in), cached. null = none found. */
  lyrics: (ask: { title: string; artist: string; album: string | null; durationMs: number | null; youtube: string | null }) => invoke<Lyrics | null>('lyrics', { ask }),
  /** Interface language, for what the shell shows itself (tray menu, taskbar buttons). */
  setUiLanguage: (lang: string) => invoke<void>('set_ui_language', { lang }),
  /** Windows' own settings page that unblocks a feature. */
  openWindowsSettings: (page: 'speech' | 'microphone') => invoke<void>('open_windows_settings', { page }),
  /** Raw JSON; validated by shared/theme/settings.sanitize. */
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: object) => invoke<void>('save_settings', { settings }),
  shieldStatus: () => invoke<{ enabled: boolean; blocked: number }>('shield_status'),
  setShield: (enabled: boolean) => invoke<void>('set_shield', { enabled }),
  /** Windows accent (light / dark theme variants); null off Windows. */
  systemAccent: () => invoke<SystemAccent | null>('system_accent'),
  restartApp: () => invoke<void>('restart_app'),
  /** Opens at sign-in: Windows' startup list (Task Manager › Startup apps), read live. null off Windows. */
  autostart: () => invoke<boolean | null>('autostart'),
  setAutostart: (on: boolean) => invoke<void>('set_autostart', { on }),
  /** Other uploads of the same song when the video refuses embedding (101 / 150), best first. */
  alternativeVideos: (trackId: number, exclude: string[]) => invoke<string[]>('alternative_videos', { trackId, exclude }),
  /** Track id → [listens, last start]: Most played / Recently played. */
  playStats: () => invoke<Record<number, [number, number]>>('play_stats'),
  cacheStats: () => invoke<CacheStats>('cache_stats'),
  /** Third-party notices shipped with the app, in the default browser. */
  openLicenses: () => invoke<void>('open_licenses'),
  updateStatus: () => invoke<UpdateStatus>('update_status'),
  updateCheck: () => invoke<void>('update_check'),
  updateInstall: () => invoke<void>('update_install'),
  onUpdate: (cb: (s: UpdateStatus) => void) => listen<UpdateStatus>('update', (e) => cb(e.payload)),
  /** Global shortcuts (Settings › Shortcuts, Everywhere). Returns the actions the OS refused. */
  setGlobalShortcuts: (list: { id: string; accelerator: string }[]) => invoke<string[]>('set_global_shortcuts', { list }),
  /** A global shortcut was pressed (app in the background too). */
  onShortcut: (cb: (id: string) => void) => listen<string>('shortcut', (e) => cb(e.payload)),
  /** Blocked embed (101 / 150): the video plays from YouTube's watch page in a webview over the slot. Physical px. */
  ytwatchOpen: (video: string, start: number, rect: WatchRect | null) => invoke<void>('ytwatch_open', { video, start, rect }),
  /** null = hidden (cover mode), still playing. */
  ytwatchPlace: (rect: WatchRect | null) => invoke<void>('ytwatch_place', { rect }),
  ytwatchCmd: (cmd: WatchCmd) => invoke<void>('ytwatch_cmd', { cmd }),
  ytwatchClose: () => invoke<void>('ytwatch_close'),
  onYtWatch: (cb: (r: WatchReport) => void) => listen<WatchReport>('ytwatch', (e) => cb(e.payload)),
  /** Live processing reports of the watch page (live.js). */
  onLive: (cb: (r: LiveReport) => void) => listen<LiveReport>('live', (e) => cb(e.payload)),
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
