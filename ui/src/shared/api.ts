import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Box } from './artbox'
import type { PlexPin, PlexServer, ServerExposure, ServerKind, ServerStatus, ServerSync, AddReport, AlbumInfo, Bookmark, DeviceOffer, DeviceOfferEvent, DevicesStatus, CacheStats, Contact, Credentials, DetectInput, Detection, Direction, DiscordStatus, Dropped, Edit, EditDraft, Effects, ExportReport, FileList, FileTags, FindReport, Heard, ImportDoubt, JumpPlaylist, LastfmStatus, LibraryChanges, LibraryData, LibraryHealth, LibraryPlaylist, LibraryTrack, ListImport, LinkImport, Listen, ListenbrainzStatus, ListRef, LiveReport, LiveSettings, LyricHit, Lyrics, LyricsAsk, LyricsChoice, MediaNow, Merged, Mix, NearbyState, NewRelease, Pickup, Play, PlayerCommand, PlayerLevels, PlayerStatus, PlaylistEdit, PluginCall, PluginInfo, PluginInspect, Pref, Presence, PushFailed, RemoteLink, RemoteSong, RoomEvent, RoomFind, RoomHeard, RoomNow, RoomReaction, RoomSong, RoomStatus, Scrobble, SearchResults, ShareCode, SharePreview, ShieldStatus, ShortcutEntry, SongTags, Source, SourceStatus, SpotifyCommand, SpotifyExport, SpotifyImport, SpotifyLibraryImport, SpotifyList, SpotifyPick, SpotifyPlayback, SpotifyProgress, SponsorSegment, Storage, SyncProbe, SyncReport, SyncStatus, SystemAccent, TagsSaved, Track, UpdateStatus, WatchCmd, WatchRect, WatchReport, YtmAccount, YtmAccounts, YtmArtist, YtmHome } from './generated'

// Every type the commands and events carry is a Rust type: `pnpm types` (ts-rs) writes it into ./generated, never by hand.
// Re-exported here, so features import them from the api.
export * from './generated'

/** Services with an account to connect. */
export type Service = Extract<Source, 'spotify' | 'youtube'>

/** Stable identity of a playlist: service + its id there (survives re-imports); own playlists by row id. */
export const playlistKey = (p: Pick<LibraryPlaylist, 'id' | 'source' | 'sourceId' | 'custom'>) => (p.custom ? `custom:${p.id}` : `${p.source}:${p.sourceId}`)

export const accountKey = (a: YtmAccount) => (a.pageId ? `${a.authuser}:${a.pageId}` : String(a.authuser))

/** Typed wrappers over Tauri commands (src-tauri/src/lib.rs). Rejections = error string. */
/** This page's id for the visualizer stream (api.vizPage). */
const vizPageId = Math.random().toString(36).slice(2) + Date.now().toString(36)

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
  /** Songs not found: a search hit becomes the version of row `trackId` (no row of its own). */
  pickVersion: (trackId: number, track: Track) => invoke<void>('pick_version', { trackId, track }),
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
  listenbrainzStatus: () => invoke<ListenbrainzStatus>('listenbrainz_status'),
  /** User token from listenbrainz.org › Settings, checked there. Returns the user name. */
  listenbrainzConnect: (token: string) => invoke<string>('listenbrainz_connect', { token }),
  listenbrainzDisconnect: () => invoke<void>('listenbrainz_disconnect'),
  listenbrainzNowPlaying: (listen: Listen) => invoke<void>('listenbrainz_now_playing', { listen }),
  /** Listens still waiting (offline, too fast). */
  listenbrainzSubmit: (listen: Listen) => invoke<number>('listenbrainz_submit', { listen }),
  /** Your music servers (Settings › Accounts), never their passwords. */
  serverStatus: () => invoke<ServerStatus[]>('server_status'),
  /** How an address as typed would be reached (null = not an address yet): the plain-http warning. */
  serverExposure: (address: string) => invoke<ServerExposure | null>('server_exposure', { address }),
  /** Checked with the server (Subsonic's `ping`, Jellyfin's token), then kept in the keychain. Plex: `plexSignIn`. */
  serverSignIn: (kind: ServerKind, address: string, user: string, password: string) => invoke<ServerStatus>('server_sign_in', { kind, address, user, password }),
  serverSignOut: (key: string) => invoke<void>('server_sign_out', { key }),
  serverSync: (key: string) => invoke<ServerSync>('server_sync', { key }),
  /** Like = star on the server, unlike = unstar. `id` = the song's server id. */
  serverStar: (id: string, on: boolean) => invoke<void>('server_star', { id, on }),
  /** A play to the server: now playing (false, no position) at its start; at its end the position heard and whether it counts. */
  serverScrobble: (id: string, startedAtMs: number, submission: boolean, positionMs?: number) => invoke<void>('server_scrobble', { id, startedAtMs, submission, positionMs: positionMs ?? null }),
  /** Sign in with Plex: a PIN, Plex's own page opened in the browser with it. */
  plexSignIn: () => invoke<PlexPin>('plex_sign_in'),
  /** Waits for the user on Plex's page (a few minutes at most), then the account's servers. */
  plexWait: () => invoke<PlexServer[]>('plex_wait'),
  plexCancel: () => invoke<void>('plex_cancel'),
  /** The server picked: its best address, its token in the keychain. */
  plexPick: (id: string) => invoke<ServerStatus>('plex_pick', { id }),
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
  shareImport: (code: string, country: string) => invoke<SpotifyLibraryImport>('share_import', { code, country }),
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
  setTrackPref: (trackId: number, pref: Pref | null) => invoke<void>('set_track_pref', { trackId, pref }),
  /** Your rating of a song in half stars (1..=10); 0 takes it off. */
  setRating: (trackId: number, stars: number) => invoke<void>('set_rating', { trackId, stars }),
  /** The user's word: music (true), not music (false), null = the app's guess again. */
  setMusic: (trackIds: number[], music: boolean | null) => invoke<void>('set_music', { trackIds, music }),
  /** Edit song info: a local file's tags rewritten (tags.rs). coverPath = new front cover; removeCover = none. */
  /** Edit song info: local songs' tags rewritten in their files (one or several, in this order), only what's given. */
  editTags: (trackIds: number[], tags: SongTags) => invoke<TagsSaved>('edit_tags', { trackIds, tags }),
  /** Each local song's tags, for Edit song info to start from. */
  readTags: (trackIds: number[]) => invoke<FileTags[]>('read_tags', { trackIds }),
  /** A local song's lyrics (LRC or plain) saved into its file: the .lrc beside it, else its tags (tags.rs). */
  writeLyrics: (trackId: number, text: string) => invoke<void>('write_lyrics', { trackId, text }),
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
  importSpotifyLink: (url: string) => invoke<SpotifyImport>('import_spotify_link', { url }),
  /** Deezer or Apple Music playlist / album link → a playlist of yours (no account); songs found on YouTube. */
  /** Settings › General › Library backup: the whole library in one file (sign-ins stay out). */
  libraryBackup: (path: string) => invoke<void>('library_backup', { path }),
  /** A backup replaces the library, then the app restarts on it (no answer on success). */
  libraryRestore: (path: string) => invoke<void>('library_restore', { path }),
  /** Android's picker addresses (shared/files.ts): a picked file copied into the cache, its path. A path stays. */
  pickedIn: (address: string) => invoke<string>('picked_in', { address }),
  /** Where to write a file that goes out to an address: name in the cache. */
  pickedTemp: (name: string) => invoke<string>('picked_temp', { name }),
  /** The file at path copied out to the address the user picked; its name there. */
  pickedOut: (path: string, address: string) => invoke<string>('picked_out', { path, address }),
  /** Explorer's drop: folders watched, audio files outside them kept, one rescan. */
  addDropped: (paths: string[]) => invoke<Dropped>('add_dropped', { paths }),
  importLink: (url: string) => invoke<LinkImport>('import_link', { url }),
  /** Ends a running importLink ("canceled", nothing made). */
  importLinkStop: () => invoke<void>('import_link_stop'),
  /** importLink's searches so far: [songs searched, songs in the list]. */
  onImportProgress: (cb: (done: number, total: number) => void) => listen<[number, number]>('import-progress', (e) => cb(e.payload[0], e.payload[1])),
  /** Add › Import a list of songs: text or a .txt / .csv file, each song found on YouTube, a playlist of the ones found. */
  importSongList: (name: string, text: string | null, path: string | null) => invoke<ListImport>('import_song_list', { name, text, path }),
  /** M3U / M3U8, XSPF or CSV by the extension of `path` (a file the user picked). */
  exportPlaylistFile: (playlistId: number, path: string) => invoke<void>('export_playlist_file', { playlistId, path }),
  /** Spotify's own web player in an app window (prototype). */
  spotifyWebOpen: () => invoke<void>('spotify_web_open'),
  /** Signed in to the Spotify web player. */
  spotifyWebStatus: () => invoke<boolean>('spotify_web_status'),
  /** Closes Spotify's window; the session stays. */
  spotifyWebClose: () => invoke<void>('spotify_web_close'),
  /** The signed-in user's playlists, read from Spotify's window. */
  spotifyLists: () => invoke<SpotifyList[]>('spotify_lists'),
  /** Reads the ticked lists there and imports them. Ended by importLinkStop ("canceled", lists saved so far stay). */
  spotifyImport: (picks: SpotifyPick[]) => invoke<SpotifyLibraryImport>('spotify_import', { picks }),
  /** Apple Music's own web player in an app window, on its sign-in sheet when signed out. */
  appleWebOpen: () => invoke<void>('apple_web_open'),
  appleWebStatus: () => invoke<boolean>('apple_web_status'),
  appleWebClose: () => invoke<void>('apple_web_close'),
  /** The signed-in user's playlists, read from Apple Music's window. */
  appleLists: () => invoke<SpotifyList[]>('apple_lists'),
  /** The ticked playlists imported; progress on onSpotifyImport. */
  appleImport: (picks: SpotifyPick[]) => invoke<SpotifyLibraryImport>('apple_import', { picks }),
  /** Opens Exportify's page; its file comes back on onSpotifyExport. */
  spotifyExportOpen: () => invoke<void>('spotify_export_open'),
  spotifyExportClose: () => invoke<void>('spotify_export_close'),
  /** Imports the ticked lists of that file. Ended by importLinkStop ("canceled", lists saved so far stay). */
  /** Exportify's file or Spotify's own data export, picked by the user: its lists, held for spotifyExportImport. */
  /** Spotify track links pasted (its app copies a list's songs so): each named from its embed page, then the import screen. */
  importSpotifyTracks: (name: string, text: string) => invoke<SpotifyLibraryImport>('import_spotify_tracks', { name, text }),
  spotifyExportFile: (path: string) => invoke<SpotifyList[]>('spotify_export_file', { path }),
  spotifyExportImport: (picks: SpotifyPick[]) => invoke<SpotifyLibraryImport>('spotify_export_import', { picks }),
  /** An iTunes / MusicBee library file (iTunes Music Library.xml): its playlists, to tick. */
  libraryFileLists: (path: string) => invoke<FileList[]>('library_file_lists', { path }),
  /** The ticked ones through the import screen ("spotify-import" events), each a playlist of yours. */
  libraryFileImport: (path: string, picks: SpotifyPick[]) => invoke<SpotifyLibraryImport>('library_file_import', { path, picks }),
  notFound: () => invoke<number[]>('not_found'),
  /** A song with no way to play yet, looked up on YouTube now at the imports' pace (Against Liner 13). True: found. */
  findNow: (trackId: number) => invoke<boolean>('find_now', { trackId }),
  libraryHealth: () => invoke<LibraryHealth>('library_health'),
  notFoundSearch: () => invoke<SpotifyLibraryImport>('not_found_search'),
  onSpotifyExport: (cb: (r: SpotifyExport) => void) => listen<SpotifyExport>('spotify-export', (e) => cb(e.payload)),
  onSpotifyImport: (cb: (p: SpotifyProgress) => void) => listen<SpotifyProgress>('spotify-import', (e) => cb(e.payload)),
  /** An import's match its length doesn't back: the song and the videos to pick from (Against Liner 9). */
  onImportDoubt: (cb: (d: ImportDoubt) => void) => listen<ImportDoubt>('import-doubt', (e) => cb(e.payload)),
  /** Every account in the Google session + keys of those synced. */
  ytmAccounts: () => invoke<YtmAccounts>('ytm_accounts'),
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
  /** A change YouTube Music refused after the fact (push.rs): already undone in the library. */
  onPushFailed: (cb: (f: PushFailed) => void) => listen<PushFailed>('push-failed', (e) => cb(e.payload)),
  /** A second launch from a taskbar Jump List entry: `jumpPending` has it. */
  onJump: (cb: () => void) => listen('jump', () => cb()),
  /** The alarm's time came (alarm.rs); `missed`: the PC was asleep then, not rung. */
  onAlarm: (cb: (missed: boolean) => void) => Promise.all([listen('alarm', () => cb(false)), listen('alarm-missed', () => cb(true))]).then((offs) => () => offs.forEach((f) => f())),
  /** The alarm's next ring (unix ms), or none: kept in Rust, so it rings from the tray too. */
  setAlarm: (at: number | null) => invoke<void>('set_alarm', { at }),
  /** The Jump List entry this launch or a later one was started from, once: 'shuffle' or 'playlist:<id>'. */
  jumpPending: () => invoke<string | null>('jump_pending'),
  /** The taskbar's Jump List written again: Shuffle all, then these playlists (installed app on Windows only). */
  setJumpList: (shuffle: string, recent: string, playlists: JumpPlaylist[]) => invoke<void>('set_jump_list', { shuffle, recent, playlists }),
  player: (cmd: PlayerCommand) => invoke<void>('player', { cmd }),
  playerStatus: () => invoke<PlayerStatus>('player_status'),
  /** Live processing of local files (crates/dsp): applies from the next block, nothing restarts. */
  sponsorSegments: (video: string) => invoke<SponsorSegment[]>('sponsor_segments', { video }),
  /** Local files about to play: their silences (`silence`) and levelling gains (`level`) go to the engine. */
  localPrepare: (paths: string[], silence: boolean, level: boolean) => invoke<void>('local_prepare', { paths, silence, level }),
  /** A local file's shape for the seek bar (0 to 255 along the song), measured once and kept; null when unreadable. */
  localWaveform: (path: string) => invoke<number[] | null>('local_waveform', { path }),
  playerLive: (settings: LiveSettings) => invoke<void>('player_live', { settings }),
  /** Live Editor: a song's saved edits (key from effects.ts songKey), or the presets (null). */
  edits: (song: string | null) => invoke<Edit[]>('edits', { song }),
  saveEdit: (id: number | null, song: string | null, name: string, effects: Effects) => invoke<number>('save_edit', { id, song, name, effects }),
  deleteEdit: (id: number) => invoke<void>('delete_edit', { id }),
  activateEdit: (song: string, id: number | null) => invoke<void>('activate_edit', { song, id }),
  /** Live Editor settings not saved as a version (kept through a close), per song. */
  editDraft: (song: string) => invoke<EditDraft | null>('edit_draft', { song }),
  saveEditDraft: (song: string, draft: EditDraft | null) => invoke<void>('save_edit_draft', { song, draft }),
  /** Live Editor: a local file's copy with the effects applied, as a new WAV (the original is only read). */
  exportEdit: (input: string, output: string, effects: Effects) => invoke<void>('export_edit', { input, output, effects }),
  exportStop: () => invoke<void>('export_stop'),
  /** Export progress, 0..1 (null: length unknown). */
  onExport: (cb: (progress: number | null) => void) => listen<number | null>('export', (e) => cb(e.payload)),
  /** Sync Mode (syncmode.rs): this PC's state, folders found, PCs met. */
  syncStatus: () => invoke<SyncStatus>('sync_status'),
  /** Hosts talked to today (Settings › Privacy); utcOffset: local time's from UTC, seconds. */
  netToday: (utcOffset: number) => invoke<Contact[]>('net_today', { utcOffset }),
  /** Before setting up a folder: is another PC syncing there, with a password? */
  syncProbe: (folder: string) => invoke<SyncProbe>('sync_probe', { folder }),
  syncSetup: (folder: string, password: string | null) => invoke<Merged>('sync_setup', { folder, password }),
  syncStop: () => invoke<void>('sync_stop'),
  syncNow: () => invoke<Merged>('sync_now'),
  syncDismiss: () => invoke<void>('sync_dismiss'),
  /** Your devices (devices.rs): this one, trusted and nearby ones, the code shown. */
  devicesStatus: () => invoke<DevicesStatus>('devices_status'),
  devicesNetwork: (on: boolean) => invoke<void>('devices_network', { on }),
  devicesAuto: (on: boolean) => invoke<void>('devices_auto', { on }),
  /** A code and its QR code for another device; the pairing's end comes as a "device-offer" event. */
  deviceOffer: (trust: boolean) => invoke<DeviceOffer>('device_offer', { trust }),
  deviceOfferStop: (code: string) => invoke<void>('device_offer_stop', { code }),
  /** The code another device shows, or the link of its QR code. */
  /** The phone's camera reads one QR code (null when cancelled or refused). Lazy: desktop never loads the plugin. */
  scanQr: async (): Promise<string | null> => {
    const scanner = await import('@tauri-apps/plugin-barcode-scanner')
    if ((await scanner.requestPermissions()) !== 'granted') return null
    const r = await scanner.scan({ formats: [scanner.Format.QRCode], windowed: false })
    return r.content || null
  },
  devicePair: (code: string, link: string | null, trust: boolean) => invoke<Merged>('device_pair', { code, link, trust }),
  deviceSync: (id: string) => invoke<Merged>('device_sync', { id }),
  deviceForget: (id: string) => invoke<void>('device_forget', { id }),
  /** Another PC's last song, if one came in since launch (pick up on another PC). */
  syncPickup: () => invoke<Pickup | null>('sync_pickup'),
  /** Another PC's changes were merged here: reload. */
  onSync: (cb: (m: Merged) => void) => listen<Merged>('sync', (e) => cb(e.payload)),
  onDevices: (cb: () => void) => listen('devices', () => cb()),
  onDeviceOffer: (cb: (r: DeviceOfferEvent) => void) => listen<DeviceOfferEvent>('device-offer', (e) => cb(e.payload)),
  onSyncPickup: (cb: (p: Pickup) => void) => listen<Pickup>('sync-pickup', (e) => cb(e.payload)),
  /** Listening rooms on the local network (rooms.rs): lead one, or join one and follow it. */
  roomStatus: () => invoke<RoomStatus>('room_status'),
  roomStart: () => invoke<RoomStatus>('room_start'),
  roomEnd: () => invoke<void>('room_end'),
  /** The host's player: what plays now (its time is taken in Rust). */
  roomHostNow: (now: RoomNow) => invoke<void>('room_host_now', { now }),
  roomHostNext: (songs: RoomSong[]) => invoke<void>('room_host_next', { songs }),
  roomReact: (reaction: RoomReaction) => invoke<void>('room_react', { reaction }),
  /** Rooms on this network (3 s of listening). */
  roomsNearby: () => invoke<RoomHeard[]>('rooms_nearby'),
  /** A room heard (`id`) or scanned (`link`) with its code. */
  roomJoin: (id: string | null, link: string | null, code: string) => invoke<RoomStatus>('room_join', { id, link, code }),
  roomLeave: () => invoke<void>('room_leave'),
  /** A room's song on this side; `now`: it plays now (a search may wait out the pace), else ahead of time. */
  roomResolve: (song: RoomSong, now: boolean) => invoke<RoomFind>('room_resolve', { song, now }),
  onRoom: (cb: (e: RoomEvent) => void) => listen<RoomEvent>('room', (e) => cb(e.payload)),
  /** A picture for a theme's background, copied in by content. Returns its name (shared/art coverImage). */
  saveBackground: (path: string) => invoke<string>('save_background', { path }),
  /** A background no theme uses any more. */
  forgetBackground: (name: string) => invoke<void>('forget_background', { name }),
  /** A .theme file with the background picture inside. */
  exportTheme: (path: string, theme: object) => invoke<void>('export_theme', { path, theme }),
  /** A .theme file read: picture stored, theme JSON back (check it with sanitizeTheme). */
  importTheme: (path: string) => invoke<unknown>('import_theme', { path }),
  /** A visualizer preset file picked by the user (.milk, .json): its text (vizPresetList.ts reads it). */
  readPreset: (path: string) => invoke<string>('read_preset', { path }),
  /** A preset's .json written where the user picked. */
  writePreset: (path: string, text: string) => invoke<void>('write_preset', { path, text }),
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
  /** The visualizer's frame for the plugin whose look shows: the latest only, never queued. */
  pluginFrame: (plugin: string, payload: unknown) => invoke<void>('plugin_frame', { plugin, payload }),
  pluginLog: (id: string) => invoke<string[]>('plugin_log', { id }),
  onPluginCall: (cb: (c: PluginCall) => void) => listen<PluginCall>('plugin-call', (e) => cb(e.payload)),
  onPluginState: (cb: (id: string) => void) => listen<string>('plugin-state', (e) => cb(e.payload)),
  /** Live Editor settings for the native engine. */
  playerEffects: (effects: Effects) => invoke<void>('player_effects', { effects }),
  /** What the native engine plays, as heard. */
  playerLevels: () => invoke<PlayerLevels>('player_levels'),
  /**
   * Visualizer frames from the native engine: packed bytes (crates/dsp `viz::Frame::pack`) at 60 Hz until vizStop,
   * one silent frame when the sound stops. `fine`: in 1/12-octave bands (121), else 1/6 (61); `wave`: with the wave
   * blocks. Resolves with a function that drops the handler.
   */
  vizStart: async (onFrame: (bytes: unknown) => void, ask = { fine: false, wave: false }) => {
    const frames = new Channel<unknown>(onFrame)
    await invoke<void>('viz_start', { page: vizPageId, frames, fine: ask.fine, wave: ask.wave })
    return () => void (frames.onmessage = () => {})
  },
  vizStop: () => invoke<void>('viz_stop'),
  /** This page owns the visualizer stream (once, at load): a start still in flight from the page before a reload is dropped. */
  vizPage: () => invoke<void>('viz_page', { page: vizPageId }),
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
  detectSong: (market: string, input: DetectInput) => invoke<Detection>('detect_song', { market, input }),
  detectStop: () => invoke<void>('detect_stop'),
  /** While listening: seconds so far, microphone level 0..1. */
  onDetect: (cb: (seconds: number, level: number) => void) => listen<[number, number]>('detect', (e) => cb(e.payload[0], e.payload[1])),
  /** Lyrics of a song (LRCLIB, then YouTube Music's own when signed in), cached. null = none found. */
  lyrics: (ask: LyricsAsk) => invoke<Lyrics | null>('lyrics', { ask }),
  /** Every lyrics found for the song, best match first (the source picker): asked online on the click, not cached. */
  lyricsChoices: (ask: LyricsAsk) => invoke<LyricsChoice[]>('lyrics_choices', { ask }),
  /** Lyrics kept for this song, shown before any other; null (or the song's own) = back to the usual order. */
  lyricsPick: (ask: LyricsAsk, picked: Lyrics | null) => invoke<void>('lyrics_pick', { ask, picked }),
  /** Library songs whose lyrics, cached when they were shown, hold the text (none under 5 letters), with their line. */
  searchLyrics: (q: string) => invoke<LyricHit[]>('search_lyrics', { q }),
  /** A moment of a library song kept, with an optional note: its bookmarks after, null when it can't keep more. */
  addBookmark: (trackId: number, ms: number, note: string) => invoke<Bookmark[] | null>('add_bookmark', { trackId, ms, note }),
  bookmarks: (trackId: number) => invoke<Bookmark[]>('bookmarks', { trackId }),
  /** One bookmark gone: its song's bookmarks after. */
  deleteBookmark: (id: number, trackId: number) => invoke<Bookmark[]>('delete_bookmark', { id, trackId }),
  /** Interface language, for what the shell shows itself (tray menu, taskbar buttons). */
  setUiLanguage: (lang: string) => invoke<void>('set_ui_language', { lang }),
  /** Windows' own settings page that unblocks a feature. */
  openWindowsSettings: (page: 'speech' | 'microphone') => invoke<void>('open_windows_settings', { page }),
  /** Raw JSON; validated by shared/theme/settings.sanitize. */
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: object) => invoke<void>('save_settings', { settings }),
  shieldStatus: () => invoke<ShieldStatus>('shield_status'),
  setShield: (enabled: boolean) => invoke<void>('set_shield', { enabled }),
  /** Windows accent (light / dark theme variants); null off Windows. */
  systemAccent: () => invoke<SystemAccent | null>('system_accent'),
  restartApp: () => invoke<void>('restart_app'),
  /** Opens at sign-in: Windows' startup list (Task Manager › Startup apps), read live. null off Windows. */
  autostart: () => invoke<boolean | null>('autostart'),
  setAutostart: (on: boolean) => invoke<void>('set_autostart', { on }),
  /** Other uploads of the same song when the video refuses embedding (101 / 150), best first. */
  alternativeVideos: (trackId: number, exclude: string[]) => invoke<string[]>('alternative_videos', { trackId, exclude }),
  /** Of these videos, those whose owner turned embedding off (oEmbed, cached a day): straight to their watch page. */
  embedRefused: (videos: string[]) => invoke<string[]>('embed_refused', { videos }),
  /** Track id → [listens, last start]: Most played / Recently played. */
  playStats: () => invoke<Record<number, [number, number, number]>>('play_stats'),
  /** Plays since `since` (unix s, two weeks at most), oldest first. */
  recentPlays: (since: number) => invoke<Play[]>('recent_plays', { since }),
  /** Every play since `since` (unix s, 0 = all), oldest first: the Stats page. */
  playHistory: (since: number) => invoke<Play[]>('play_history', { since }),
  cacheStats: () => invoke<CacheStats>('cache_stats'),
  /** Bytes the cover cache holds on disk. */
  artCacheSize: () => invoke<number>('art_cache_size'),
  /** Cover cache cap in MB (the folder is pruned in the background when over it). */
  setArtCacheCap: (mb: number) => invoke<void>('set_art_cache_cap', { mb }),
  /** Empties the cover cache: covers download again when shown. Bytes freed. */
  clearArtCache: () => invoke<number>('clear_art_cache'),
  /** Settings › General › Storage: bytes by kind (webview: WebView2's folder, a PC's only). */
  storage: () => invoke<Storage>('storage'),
  /** Lyrics found and songs measured, or the diagnostics log; never the library. Bytes freed. */
  clearStorage: (what: 'caches' | 'log') => invoke<number>('clear_storage', { what }),
  /** Third-party notices shipped with the app, in the default browser. */
  openLicenses: () => invoke<void>('open_licenses'),
  /** The UI is up: plugins, update and Sync Mode rounds may start (Rust also starts them after a few seconds). */
  appReady: () => invoke<void>('app_ready'),
  updateStatus: () => invoke<UpdateStatus>('update_status'),
  updateCheck: () => invoke<void>('update_check'),
  updateInstall: () => invoke<void>('update_install'),
  onUpdate: (cb: (s: UpdateStatus) => void) => listen<UpdateStatus>('update', (e) => cb(e.payload)),
  /** Global shortcuts (Settings › Shortcuts, Everywhere). Returns the actions the OS refused. */
  setGlobalShortcuts: (list: ShortcutEntry[]) => invoke<string[]>('set_global_shortcuts', { list }),
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
  /** Share card (PNG bytes) saved as the picked .png or .jpg; returns the file written. */
  savePicture: (png: Uint8Array, path: string) => invoke<string>('save_picture', { png: Array.from(png), path }),
  /** Discord Rich Presence add-on: track shown under the user's Discord application (null = nothing). */
  discordPresence: (clientId: string, presence: Presence | null) => invoke<void>('discord_presence', { clientId, presence }),
  discordOff: () => invoke<void>('discord_off'),
  discordStatus: () => invoke<DiscordStatus>('discord_status'),
  /** The artist's picture for Discord (https, square). `ask`: YouTube Music may be asked (paced in Rust); null: not now. */
  discordArtistArt: (name: string, ask: boolean) => invoke<string | null>('discord_artist_art', { name, ask }),
  /** Home's New from your artists: asks MusicBrainz once a day (the section is off until turned on). */
  newReleases: () => invoke<NewRelease[]>('new_releases'),
  /** Imported YouTube Music playlist: added on YouTube (Liked Music = like), then locally. */
  addToYoutube: (id: number, trackIds: number[]) => invoke<AddReport>('add_to_youtube', { id, trackIds }),
  /** Raw JSON; validated by features/player/session. */
  loadSession: () => invoke<unknown>('load_session'),
  saveSession: (session: object) => invoke<void>('save_session', { session }),
  /** A new player is about to start: the hidden window's page stays `visible` until the music moves. */
  holdPage: () => invoke<void>('hold_page'),
  /** Picture-in-picture (pipMode.ts, desktop): the window small and above the others, at `place` (its last: physical x, y, width, height) when still on a screen; off: back as it was, giving the small one's place. */
  pip: (on: boolean, place: [number, number, number, number] | null) => invoke<[number, number, number, number] | null>('pip', { on, place }),
  /** Windows media panel; null = nothing playing. Cover: local file's (trackId), else `art` URL. */
  mediaUpdate: (now: MediaNow | null, trackId: number | null, art: string | null) => invoke<void>('media_update', { now, trackId, art }),
  /** Phone remote: `labels` = the page's words in the interface's language, keyed by the English text. */
  remoteStart: (labels: Record<string, string>, fresh: boolean) => invoke<RemoteLink>('remote_start', { labels, fresh }),
  remoteStop: () => invoke<void>('remote_stop'),
  /** Streaming overlay: the phone remote's server (this PC only when alone); returns its link for OBS. */
  overlayStart: (viz: boolean) => invoke<string>('overlay_start', { viz }),
  overlayStop: () => invoke<void>('overlay_stop'),
  /** The overlay's visualizer bars (0 to 255); false = no page reads them. */
  overlayBars: (levels: number[]) => invoke<boolean>('overlay_bars', { levels }),
  remoteQueue: (next: RemoteSong[]) => invoke<void>('remote_queue', { next }),
  /** One line in the local diagnostics log (shared/diag.ts). message = our words; detail = what an error said, shown only with Include details. */
  diagLog: (level: 'info' | 'warn' | 'error', area: string, message: string, detail?: string) => invoke<void>('diag_log', { level, area, message, detail }),
  /** Settings › About › Copy diagnostics: the text for a bug report. details = song titles, account names and paths too. */
  diagReport: (details: boolean) => invoke<string>('diag_report', { details }),
}
