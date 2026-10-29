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
  /** When this PC's library got it (unix s); null/absent = added before the app kept dates. */
  addedAt?: number | null
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

/** src-tauri library: the whole library. orders = playlist id → its track ids in order (empty playlists left out). */
export interface LibraryData {
  tracks: LibraryTrack[]
  playlists: LibraryPlaylist[]
  orders: Record<number, number[]>
}

/** crates/core library::Changes: what was written since the last library read (app/libraryPatch.ts applies it). */
export interface LibraryChanges {
  /** Whole rows: new or changed songs, and the other songs of their channels (musicness can follow). */
  tracks: LibraryTrack[]
  /** Out of the library list. */
  gone: number[]
  playlists: LibraryPlaylist[]
  playlistsGone: number[]
  /** Changed playlists' track ids in order. */
  orders: Record<number, number[]>
  /** Plays or mix preferences written since: play counts to read again. */
  history: boolean
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

/** crates/connectors ytmusic::Home: shelves, and the mood chips that filter them (params = the chip's ask). */
export interface YtmHome {
  shelves: Shelf[]
  moods: { title: string; params: string }[]
}

export interface Shelf {
  title: string
  items: HomeItem[]
}

/** An artist's YouTube Music page (src-tauri ytm_artist): top songs, every song behind allSongs, then shelves. */
export interface YtmArtist {
  name: string
  art: string | null
  songs: Track[]
  allSongs: ListRef | null
  shelves: Shelf[]
}

/** src-tauri update::Status: what the background updater is doing. */
export type UpdateState = { state: 'idle' | 'checking' | 'upToDate' } | { state: 'available'; version: string; notes: string | null } | { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string; notes: string | null } | { state: 'installing'; version: string } | { state: 'error'; message: string }
export type UpdateStatus = UpdateState & {
  current: string
  /** Unix seconds. */
  lastCheck: number | null
  lastUpdate: { from: string; to: string; at: number; notes?: string | null } | null
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
  | { type: 'live'; on: boolean; listen: boolean; adaptive: boolean; targetLufs: number; ending: boolean; bands: boolean; gain: number | null; effects?: Effects }

/** crates/dsp control.rs: live processing settings of the native engine. */
export interface LiveSettings {
  adaptive: boolean
  targetLufs: number
  /** The app fades the song out: Adaptive Sound holds. */
  ending: boolean
  /** The visualizer wants the bands. */
  bands: boolean
}
/** crates/dsp effects.rs: Live Editor settings (numbers only; clamped by Rust and live.js). */
export interface Effects {
  on: boolean
  speed: number
  tempo: number
  pitch: number
  bass: number
  /** dB per band, 10 bands (effects.ts EQ_FREQS). */
  eq: number[]
  reverb: { mix: number; size: number; damping: number; predelayMs: number }
  echo: { mix: number; timeMs: number; feedback: number }
  space: { on: boolean; azimuth: number; elevation: number; distance: number; rotate: boolean; periodS: number; room: number }
  /** Distortion, 0..1 (0 = off). */
  drive: number
  compress: number
  width: number
  balance: number
}

/** crates/core library.rs Edit: effects as JSON (parse with effects.ts cleanEffects). */
export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  api: number
  main: string
  permissions: string[]
  homepage?: string
}

export interface PluginInfo {
  id: string
  manifest: PluginManifest | null
  on: boolean
  running: boolean
  granted: string[]
  error: string | null
  folder: string
}

export interface PluginInspect {
  manifest: PluginManifest
  installed: string | null
  newPermissions: string[]
  files: number
  size: number
}

/** A plugin asks the interface for something (permission checked in Rust). */
export interface PluginCall {
  plugin: string
  id: number
  method: string
  args: Record<string, unknown>
}

/** music_core::syncmode::Merged: what another PC's snapshot changed here. */
export interface Merged {
  playlists: number
  deleted: number
  songs: number
  removed: number
  plays: number
  edits: number
  settings: number
}

export interface SyncDevice {
  name: string
  at: number
  accounts: { spotify: boolean; youtube: boolean }
}

export interface SyncStatus {
  onedrive: string[]
  folder: string | null
  protected: boolean
  asked: boolean
  deviceName: string
  devices: SyncDevice[]
  last: number | null
  error: string | null
}

export interface SyncProbe {
  exists: boolean
  protected: boolean
  devices: number
}

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
  /** Visualizer: dB per band (crates/dsp spectrum.rs), when asked for. */
  bands?: number[]
}
/** src-tauri speech.rs: why voice search heard nothing. */
export type VoiceMiss = 'speechOff' | 'micBlocked' | 'noMic' | 'silence' | 'unclear' | 'offline' | 'language' | 'canceled' | 'failed'
export type Heard = { kind: 'text'; text: string } | { kind: 'miss'; miss: VoiceMiss }

/** src-tauri detect_song: Music Detector outcome. */
export type DetectMiss = 'noMic' | 'micBlocked' | 'micBusy' | 'noOutput' | 'silent' | 'unclear' | 'canceled' | 'badToken' | 'limit' | 'freeLimit' | 'offline' | 'failed'
export type Detection = { kind: 'found'; track: Track } | { kind: 'unknown' } | { kind: 'miss'; miss: DetectMiss; detail: string | null }

/** crates/core lyrics.rs. Lines synced (ms); empty = plain only. */
export interface Lyrics {
  lines: { ms: number; text: string; endMs?: number | null }[]
  plain: string | null
  instrumental: boolean
  source: string
}

/** ytwatch.rs LiveReport (watch page). */
export interface LiveReport {
  attached?: boolean
  error?: string | null
  levels?: LiveLevels | null
  /** The song ended here (s of the video), silence after it: an early end. */
  end?: number
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

/** crates/core search::Origin: which search found a hit (YouTube videos, YouTube Music songs, Apple Music). */
export type Origin = 'youtube' | 'ytmusic' | 'apple'

export interface SearchHit extends Track {
  libraryId: number | null
  musicness: Musicness
  from: Origin[]
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

/** music_core::sync::Direction: which way songs travel between an account and the library. */
export type Direction = 'both' | 'pull' | 'push' | 'off'

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
  /** Songs new to you (YouTube Music radios), `at` = place in the whole mix. */
  found?: { at: number; track: Track }[]
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

/** connectors lastfm::Scrobble: one listen (timestamp = start, unix s). */
export interface Scrobble {
  artist: string
  track: string
  album: string | null
  durationS: number | null
  timestamp: number
}

/** src-tauri lastfm::Status. */
export interface LastfmStatus {
  configured: boolean
  user: string | null
  waiting: number
}

/** src-tauri AlbumSlot: one catalog song of an album, and your copy when you have it. */
export interface AlbumSlot {
  disc: number
  number: number
  track: Track
  libraryId: number | null
}

/** src-tauri AlbumInfo. */
export interface AlbumInfo {
  year: number | null
  slots: AlbumSlot[]
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
  library: () => invoke<LibraryData>('library'),
  /** null = too much changed: read the library whole. */
  libraryChanges: () => invoke<LibraryChanges | null>('library_changes'),
  playlistTracks: (id: number) => invoke<LibraryTrack[]>('playlist_tracks', { id }),
  /** New playlist id for create / duplicate. */
  editPlaylist: (edit: PlaylistEdit) => invoke<number | null>('edit_playlist', { edit }),
  /** Every occurrence out of a playlist: custom here, YouTube Music on the account (owner only; Liked = unlike). */
  removeFromPlaylist: (id: number, trackId: number) => invoke<void>('remove_from_playlist', { id, trackId }),
  /** Out of the library and every playlist here; syncs and folder scans leave it out. */
  removeFromLibrary: (trackId: number) => invoke<void>('remove_from_library', { trackId }),
  /** Duplicates: `others` become `keep` (every source, playlist spot and play on one song). */
  mergeTracks: (keep: number, others: number[]) => invoke<void>('merge_duplicates', { keep, others }),
  /** Pasted YouTube link → library. Returns "Artist – Title". */
  addLink: (url: string) => invoke<string>('add_link', { url }),
  searchCatalogs: (query: string, country: string) => invoke<SearchResults>('search_catalogs', { query, country }),
  /** What YouTube's search box would suggest (lang = interface language). */
  searchSuggestions: (query: string, lang: string, country: string) => invoke<string[]>('search_suggestions', { query, lang, country }),
  /** Returns library row id. Finds a YouTube version when missing (1 search). */
  addTrack: (track: Track) => invoke<number>('add_track', { track }),
  /** Search hit with its YouTube version (one search if missing), nothing written: play without adding. */
  resolveTrack: (track: Track) => invoke<Track>('resolve_track', { track }),
  /** mood = a chip's params: the home filtered to it. */
  ytmHome: (mood?: string) => invoke<YtmHome>('ytm_home', { mood: mood ?? null }),
  ytmList: (list: ListRef) => invoke<Track[]>('ytm_list', { list }),
  /** Null = no artist of that name on YouTube Music. Works signed out. */
  ytmArtist: (name: string) => invoke<YtmArtist | null>('ytm_artist', { name }),
  /** Year and every song of an album from the Apple catalog, with which ones you have. Null = not in the store. */
  lastfmStatus: () => invoke<LastfmStatus>('lastfm_status'),
  /** Key + shared secret from last.fm/api, then the user allows the app on last.fm (browser). Returns the user name. */
  lastfmConnect: (key: string, secret: string) => invoke<string>('lastfm_connect', { key, secret }),
  lastfmDisconnect: () => invoke<void>('lastfm_disconnect'),
  lastfmNowPlaying: (scrobble: Scrobble) => invoke<void>('lastfm_now_playing', { scrobble }),
  /** Listens still waiting (offline). */
  lastfmScrobble: (scrobble: Scrobble) => invoke<number>('lastfm_scrobble', { scrobble }),
  albumInfo: (artist: string, album: string, trackIds: number[], country: string) => invoke<AlbumInfo | null>('album_info', { artist, album, trackIds, country }),
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
  /** The user's word: music (true), not music (false), null = the app's guess again. */
  setMusic: (trackIds: number[], music: boolean | null) => invoke<void>('set_music', { trackIds, music }),
  /** Edit song info: a local file's tags rewritten (tags.rs). coverPath = new front cover; removeCover = none. */
  editTags: (trackId: number, tags: { title: string; artist: string; album: string | null; coverPath: string | null; removeCover: boolean }) => invoke<void>('edit_tags', { trackId, tags }),
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
  importSpotifyLink: (url: string) => invoke<{ playlistId: number; name: string; tracks: number; playable: number; truncated: boolean }>('import_spotify_link', { url }),
  /** Spotify's own web player in an app window (prototype). */
  spotifyWebOpen: () => invoke<void>('spotify_web_open'),
  /** Signed in to the Spotify web player. */
  spotifyWebStatus: () => invoke<boolean>('spotify_web_status'),
  /** Every account in the Google session + keys of those synced. */
  ytmAccounts: () => invoke<{ signedIn: boolean; accounts: YtmAccount[]; picked: string[] }>('ytm_accounts'),
  /** Synced accounts, in order (first = exports). */
  setYtmAccounts: (accounts: YtmAccount[]) => invoke<void>('set_ytm_accounts', { accounts }),
  /** Account key ("spotify", "youtube:<accountKey>") → direction; missing = both. */
  syncDirections: () => invoke<Record<string, Direction>>('sync_directions'),
  setSyncDirection: (key: string, direction: Direction) => invoke<void>('set_sync_direction', { key, direction }),
  localFolders: () => invoke<string[]>('local_folders'),
  /** Saves folders, rescans. Returns local file count. */
  setLocalFolders: (folders: string[]) => invoke<number>('set_local_folders', { folders }),
  rescanLocal: () => invoke<number>('rescan_local'),
  /** A watched local folder changed and was scanned again (src-tauri folders.rs): local file count. */
  onLocalChanged: (cb: (count: number) => void) => listen<number>('local-changed', (e) => cb(e.payload)),
  player: (cmd: PlayerCommand) => invoke<void>('player', { cmd }),
  playerStatus: () => invoke<PlayerStatus>('player_status'),
  /** Live processing of local files (crates/dsp): applies from the next block, nothing restarts. */
  playerLive: (settings: LiveSettings) => invoke<void>('player_live', { settings }),
  /** Live Editor: a song's saved edits (key from effects.ts songKey), or the presets (null). */
  edits: (song: string | null) => invoke<Edit[]>('edits', { song }),
  saveEdit: (id: number | null, song: string | null, name: string, effects: Effects) => invoke<number>('save_edit', { id, song, name, effects }),
  deleteEdit: (id: number) => invoke<void>('delete_edit', { id }),
  activateEdit: (song: string, id: number | null) => invoke<void>('activate_edit', { song, id }),
  /** Live Editor settings not saved as a version (kept through a close), per song. */
  editDraft: (song: string) => invoke<{ effects: Effects; version: number | null } | null>('edit_draft', { song }),
  saveEditDraft: (song: string, draft: { effects: Effects; version: number | null } | null) => invoke<void>('save_edit_draft', { song, draft }),
  /** Live Editor: a local file's copy with the effects applied, as a new WAV (the original is only read). */
  exportEdit: (input: string, output: string, effects: Effects) => invoke<void>('export_edit', { input, output, effects }),
  exportStop: () => invoke<void>('export_stop'),
  /** Export progress, 0..1 (null: length unknown). */
  onExport: (cb: (progress: number | null) => void) => listen<number | null>('export', (e) => cb(e.payload)),
  /** Sync Mode (syncmode.rs): this PC's state, folders found, PCs met. */
  syncStatus: () => invoke<SyncStatus>('sync_status'),
  /** Before setting up a folder: is another PC syncing there, with a password? */
  syncProbe: (folder: string) => invoke<SyncProbe>('sync_probe', { folder }),
  syncSetup: (folder: string, password: string | null) => invoke<Merged>('sync_setup', { folder, password }),
  syncStop: () => invoke<void>('sync_stop'),
  syncNow: () => invoke<Merged>('sync_now'),
  syncDismiss: () => invoke<void>('sync_dismiss'),
  /** Local network: a code for the other PC; the result comes as a "sync-offer" event. */
  syncOffer: () => invoke<string>('sync_offer'),
  syncOfferStop: () => invoke<void>('sync_offer_stop'),
  syncJoin: (code: string) => invoke<Merged>('sync_join', { code }),
  /** Another PC's changes were merged here: reload. */
  onSync: (cb: (m: Merged) => void) => listen<Merged>('sync', (e) => cb(e.payload)),
  onSyncOffer: (cb: (r: { Ok?: Merged; Err?: string }) => void) => listen<{ Ok?: Merged; Err?: string }>('sync-offer', (e) => cb(e.payload)),
  /** A picture for a theme's background, copied in by content. Returns its name (shared/art coverImage). */
  saveBackground: (path: string) => invoke<string>('save_background', { path }),
  /** A background no theme uses any more. */
  forgetBackground: (name: string) => invoke<void>('forget_background', { name }),
  /** A .theme file with the background picture inside. */
  exportTheme: (path: string, theme: object) => invoke<void>('export_theme', { path, theme }),
  /** A .theme file read: picture stored, theme JSON back (check it with sanitizeTheme). */
  importTheme: (path: string) => invoke<unknown>('import_theme', { path }),
  /** Third-party plugins (src-tauri plugins.rs, crates/plugins). */
  plugins: () => invoke<PluginInfo[]>('plugins_list'),
  /** A folder before installing it: its manifest and the permissions it asks for. */
  pluginInspect: (folder: string) => invoke<PluginInspect>('plugin_inspect', { folder }),
  /** Copies and turns on the plugin in `folder`, its permissions approved. Returns its id. */
  pluginInstall: (folder: string) => invoke<string>('plugin_install', { folder }),
  pluginSet: (id: string, on: boolean) => invoke<void>('plugin_set', { id, on }),
  pluginUninstall: (id: string) => invoke<void>('plugin_uninstall', { id }),
  pluginReply: (plugin: string, id: number, ok: boolean, value?: unknown, error?: string) => invoke<void>('plugin_reply', { plugin, id, ok, value: value ?? null, error: error ?? null }),
  /** App events for plugins allowed to hear them: 'track', 'playing'. */
  pluginEvent: (name: 'track' | 'playing', payload: unknown) => invoke<void>('plugin_event', { name, payload }),
  /** A plugin's menu item ('command') or panel control ('panel') was used. */
  pluginInput: (plugin: string, name: 'command' | 'panel', payload: unknown) => invoke<void>('plugin_input', { plugin, name, payload }),
  pluginLog: (id: string) => invoke<string[]>('plugin_log', { id }),
  onPluginCall: (cb: (c: PluginCall) => void) => listen<PluginCall>('plugin-call', (e) => cb(e.payload)),
  onPluginState: (cb: (id: string) => void) => listen<string>('plugin-state', (e) => cb(e.payload)),
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
  /** input: the microphone, or what this PC plays (pause the app's own playback first). */
  detectSong: (market: string, input: 'mic' | 'pc') => invoke<Detection>('detect_song', { market, input }),
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
  /** Plays since `since` (unix s, two weeks at most), oldest first. */
  recentPlays: (since: number) => invoke<Play[]>('recent_plays', { since }),
  /** Every play since `since` (unix s, 0 = all), oldest first: the Stats page. */
  playHistory: (since: number) => invoke<Play[]>('play_history', { since }),
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
  /** A new player is about to start: the hidden window's page stays `visible` until the music moves. */
  holdPage: () => invoke<void>('hold_page'),
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
