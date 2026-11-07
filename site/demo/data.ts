import type { LibraryPlaylist, LibraryTrack, LyricsAsk, Play, PlayerCommand, PlayerStatus, RoomStatus, SearchHit, Source } from '../../ui/src/shared/api'
import { emit } from './tauri'
import { levels, startFrames, stopFrames, type Frames } from './viz'

// Everything here is invented: artists, albums, songs. Covers are drawn below, from a palette and a shape.

type Shape = 'sun' | 'rings' | 'bars' | 'hills' | 'split' | 'dots' | 'arc'
type Album = { title: string; artist: string; colors: [string, string, string]; shape: Shape; songs: string[] }

const ALBUMS: Album[] = [
  { title: 'Low Tide Radio', artist: 'Halden Marsh', colors: ['#0f3d4c', '#f2c14e', '#1b6b7a'], shape: 'sun', songs: ['Shipping Forecast', 'Salt on the Dial', 'Grey Water Waltz', 'Pier Lights Out', 'Harbour Master', 'Last Ferry'] },
  { title: 'Night Bus Home', artist: 'The Quiet Tenants', colors: ['#1d1a3a', '#ff6b6b', '#3b3478'], shape: 'bars', songs: ['Top Deck', 'Request Stop', 'Ring Road', 'Yellow Line', 'Terminus'] },
  { title: 'Copper Season', artist: 'Marlow Finch', colors: ['#7a3b1d', '#f4e3c1', '#b8622f'], shape: 'hills', songs: ['Rust Belt Lullaby', 'October Wire', 'Kettle Song', 'Slow Burn Avenue', 'Penny Arcade Dawn'] },
  { title: 'Paper Lanterns', artist: 'Ines Okoro-Vale', colors: ['#f3e9dc', '#c8553d', '#e8b4a0'], shape: 'dots', songs: ['Festival Rain', 'Folded Letter', 'Hold the Flame', 'Riverside, Late', 'Thirteen Wishes'] },
  { title: 'Soft Machinery', artist: 'Kaito Brandt', colors: ['#20242c', '#7fd1ae', '#39424f'], shape: 'rings', songs: ['Idle Gears', 'Warm Start', 'Conveyor Hymn', 'Night Shift Dream', 'Oil and Honey', 'Cooling Down'] },
  { title: 'Long Way Round the Lake', artist: 'Wren Hollis', colors: ['#2f5d50', '#e9f0e4', '#4f8a75'], shape: 'arc', songs: ['Cold Water Hands', 'Birch Road', 'Two Oars', 'The Far Shore', 'Coming Back Slower'] },
  { title: 'Second Floor Windows', artist: 'Juno Aldana', colors: ['#e7c6d5', '#3a2a4d', '#c98fb0'], shape: 'split', songs: ['Curtain Call for Nobody', 'Neighbours', 'Sunday Laundry', 'Fire Escape Song', 'Radiator Blues'] },
  { title: 'Static Bloom', artist: 'Ottolie Reyes', colors: ['#3a0f3f', '#ffb347', '#6d1f6b'], shape: 'rings', songs: ['Interference', 'Bloom Cycle', 'Pirate Station', 'Dead Air Dance', 'Carrier Wave'] },
  { title: 'Harbour Lights, 4 a.m.', artist: 'Nils Arrow', colors: ['#0b1f33', '#9fd3ff', '#16395a'], shape: 'dots', songs: ['Empty Quay', 'Sodium Glow', 'Tugboat Choir', 'Morning Is a Rumour'] },
  { title: 'Slow Orbit', artist: 'Velvet Cartographers', colors: ['#141414', '#f1f1f1', '#3d3d3d'], shape: 'arc', songs: ['Perihelion', 'Map of the Dark Side', 'Weightless Sunday', 'Return Window', 'Long Exposure'] },
  { title: 'Field Notes', artist: 'Amara Lindqvist', colors: ['#d9d3b4', '#3f4a2b', '#a9a878'], shape: 'hills', songs: ['Hedgerow', 'Barn Swallow', 'Wet Boots', 'Almanac', 'First Frost'] },
  { title: 'Kitchen Table Demos', artist: 'Rosalind Teague', colors: ['#c33c2e', '#fbeee0', '#8f261b'], shape: 'bars', songs: ['Take Four', 'Tea Gone Cold', 'Unfinished Chorus', 'Mum on Harmonies'] },
]

const LISTS = ['Sunday Morning', 'Train to Work', 'Late Drive', 'Kitchen Dancing', 'Focus, Mostly']

// A size of its own: a canvas reads its colours (Now Playing's tint and glow); without one Chrome draws one pixel.
function drawn({ colors: [bg, ink, soft], shape }: Album) {
  const parts: Record<Shape, string> = {
    sun: `<circle cx="50" cy="44" r="23" fill="${ink}"/><rect y="62" width="100" height="38" fill="${soft}"/><rect y="70" width="100" height="3" fill="${bg}"/><rect y="80" width="100" height="5" fill="${bg}"/>`,
    rings: [42, 32, 22, 12].map((r, i) => `<circle cx="50" cy="50" r="${r}" fill="${i % 2 ? bg : i ? ink : soft}"/>`).join(''),
    bars: [14, 30, 22, 44, 34, 58, 26].map((h, i) => `<rect x="${12 + i * 11}" y="${78 - h}" width="8" height="${h}" fill="${i % 3 ? soft : ink}"/>`).join(''),
    hills: `<circle cx="72" cy="26" r="11" fill="${ink}"/><path d="M0 70 Q28 38 56 66 T100 58 V100 H0Z" fill="${soft}"/><path d="M0 86 Q34 60 66 84 T100 80 V100 H0Z" fill="${ink}"/>`,
    split: `<rect x="50" width="50" height="100" fill="${ink}"/><circle cx="50" cy="50" r="26" fill="${soft}"/>`,
    dots: Array.from({ length: 25 }, (_, i) => `<circle cx="${18 + (i % 5) * 16}" cy="${18 + Math.floor(i / 5) * 16}" r="${2 + ((i * 7) % 6)}" fill="${i % 4 ? ink : soft}"/>`).join(''),
    arc: `<path d="M12 88 A38 38 0 0 1 88 88Z" fill="${soft}"/><path d="M26 88 A24 24 0 0 1 74 88Z" fill="${ink}"/><circle cx="74" cy="24" r="5" fill="${ink}"/>`,
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${parts[shape]}</svg>`)}`
}

const COVERS = ALBUMS.map(drawn)

// Genre and year, per album: only songs with a local file show them, as in the app (local files' tags).
const TAGS: [string, number][] = [['Folk', 2019], ['Indie rock', 2021], ['Americana', 2017], ['Afropop', 2022], ['Electronic', 2020], ['Folk', 2016], ['Indie pop', 2023], ['Synth-pop', 2018], ['Ambient', 2024], ['Post-rock', 2015], ['Folk', 2014], ['Indie pop', 2012]]

// Each song's sources: a good part on two services, to show one track for both.
const SOURCES: Source[][] = [['youtube', 'spotify'], ['youtube'], ['spotify'], ['local'], ['apple'], ['youtube', 'apple'], ['youtube']]

const seconds = (s: string) => 148 + ([...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0) % 132

export const TRACKS: LibraryTrack[] = ALBUMS.flatMap((a, n) => a.songs.map((title) => ({ title, artist: a.artist, album: a.title, n }))).map(({ n, ...t }, i) => ({
  ...t,
  id: i + 1,
  added: i + 1,
  addedAt: null,
  durationMs: seconds(t.title) * 1000,
  isrc: null,
  ids: Object.fromEntries(SOURCES[i % SOURCES.length].map((s) => [s, `demo-${i + 1}`])),
  art: `demo:${n}`,
  ...(SOURCES[i % SOURCES.length].includes('local') ? { genre: TAGS[n % TAGS.length][0], year: TAGS[n % TAGS.length][1] } : {}),
}))

const PLAYLISTS: LibraryPlaylist[] = LISTS.map((name, i) => ({ id: i + 1, source: i % 2 ? 'spotify' : 'youtube', sourceId: `demo-${i + 1}`, name, trackCount: 9 + i, custom: false, newestFirst: false, orderManual: false }))
const inList = (id: number) => [...TRACKS.slice(id * 11), ...TRACKS].filter((t) => t.id % 3 !== id % 3).slice(0, 8 + id)

/** Cover of a track or an album, through the app's `art` scheme. */
export function art(path: string) {
  const local = path.match(/^local\/(\d+)/)
  const album = local ? TRACKS[Number(local[1]) - 1]?.art : decodeURIComponent(path)
  return COVERS[Number(album?.replace('demo:', ''))] ?? COVERS[0]
}

// Songs a search finds outside the library.
const CATALOG = [
  { title: 'Harbour Wall', artist: 'Nils Arrow', album: 'Harbour Lights, 4 a.m.', from: 'ytmusic', n: 8 },
  { title: 'The Harbour Line', artist: 'Halden Marsh', album: 'Low Tide Radio', from: 'apple', n: 0 },
  { title: 'Harbour Mouth (Live at the Boathouse)', artist: 'Wren Hollis', album: null, from: 'youtube', n: 5 },
  { title: 'Harbour Bells', artist: 'Amara Lindqvist', album: 'Field Notes', from: 'ytmusic', n: 10 },
  { title: 'Goodnight, Harbour', artist: 'The Quiet Tenants', album: null, from: 'youtube', n: 1 },
] as const

function search({ query }: Record<string, unknown>) {
  const word = String(query).toLowerCase()
  const known: SearchHit[] = TRACKS.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(word)).map((t) => ({ ...t, libraryId: t.id, from: t.ids.apple ? ['apple'] : ['ytmusic'] }))
  const more: SearchHit[] = CATALOG.filter((c) => c.title.toLowerCase().includes(word)).map((c, i) => ({ title: c.title, artist: c.artist, album: c.album, durationMs: seconds(c.title) * 1000, isrc: null, ids: { [c.from === 'apple' ? 'apple' : 'youtube']: `demo-found-${i}` }, art: `demo:${c.n}`, libraryId: null, from: [c.from] }))
  return { hits: [...more, ...known], errors: [] }
}

// Written for this page.
const VERSES = ['Pier lights out along the bay', 'The last boat took the tide away', 'I kept your name in the radio hum', 'Counting the waves till the morning comes', 'Salt on my hands and the dial turned low', "Nobody's listening, so here we go", "Slow down, slow down, the harbour's asleep", 'Some things are easier not to keep']

function lyrics({ ask }: Record<string, unknown>) {
  const { durationMs } = ask as LyricsAsk
  const lines = Array.from({ length: Math.floor((durationMs ?? 200_000) / 5200) }, (_, i) => ({ ms: 2000 + i * 5200, text: VERSES[i % VERSES.length] }))
  return { lines, plain: null, instrumental: false, source: 'Written for this demo' }
}

// Every song here sings VERSES: a line typed finds a few of them, as the search page's "In the lyrics".
function sung({ q }: Record<string, unknown>) {
  const text = String(q).toLowerCase().trim()
  const line = text.length >= 5 ? VERSES.find((v) => v.toLowerCase().includes(text)) : undefined
  return line ? TRACKS.slice(3, 6).map((t) => ({ trackId: t.id, line })) : []
}

// Bookmarks inside a song: kept for the visit.
const MARKS: { id: number; trackId: number; ms: number; note: string }[] = []
const marksOf = (trackId: unknown) => MARKS.filter((b) => b.trackId === trackId).sort((a, b) => a.ms - b.ms)
function addMark({ trackId, ms, note }: Record<string, unknown>) {
  const near = MARKS.find((b) => b.trackId === trackId && Math.abs(b.ms - Number(ms)) < 1000)
  if (near) near.note = String(note) || near.note
  else MARKS.push({ id: MARKS.length + 1, trackId: Number(trackId), ms: Number(ms), note: String(note) })
  return marksOf(trackId)
}
function dropMark({ id, trackId }: Record<string, unknown>) {
  const at = MARKS.findIndex((b) => b.id === id)
  if (at >= 0) MARKS.splice(at, 1)
  return marksOf(trackId)
}

// Two months of listening, for Home, Stats and Mixes.
const NOW = Math.floor(Date.now() / 1000)
const PLAYS: Play[] = Array.from({ length: 480 }, (_, i) => {
  const t = TRACKS[(i * 13 + (i >> 3)) % 27]
  return { trackId: t.id, startedAt: NOW - i * 10_800 - ((i * 977) % 3000), listenedMs: t.durationMs ?? 0, completed: true }
})

const MIXES = ['Daily Mix 1', 'Daily Mix 2', 'Daily Mix 3'].map((title, i) => ({ id: `demo-${i}`, title, reason: 'From what you played this week', trackIds: TRACKS.filter((t) => t.id % 3 === i).slice(0, 14).map((t) => t.id), kind: 'daily', words: {} }))

// The engine: no sound, only a position that moves.
const OPENING = TRACKS.findIndex((t) => t.ids.local)
// Two songs the listener added: Up next's own block.
const ADDED = [OPENING + 19, OPENING + 34]
const ORDER = [...TRACKS.keys()].filter((i) => !ADDED.includes(i))
ORDER.splice(OPENING + 1, 0, ...ADDED)

const engine = { path: null as string | null, at: 0, since: 0, paused: true }
const durationOf = (path: string | null) => (path ? (TRACKS[Number(path.replace('demo-', '')) - 1]?.durationMs ?? 200_000) : null)
const position = () => engine.at + (engine.paused ? 0 : Date.now() - engine.since)

function player(cmd: PlayerCommand) {
  if (cmd.type === 'play') Object.assign(engine, { path: cmd.paths[0] ?? null, at: 0, since: Date.now(), paused: false })
  if (cmd.type === 'toggle') Object.assign(engine, { at: position(), since: Date.now(), paused: !engine.paused })
  if (cmd.type === 'seek') Object.assign(engine, { at: cmd.ms, since: Date.now() })
  if (cmd.type === 'stop') Object.assign(engine, { path: null, at: 0, paused: true })
  return null
}

const status = (): PlayerStatus => {
  const durationMs = durationOf(engine.path)
  const positionMs = position()
  return { path: engine.path, positionMs, durationMs, paused: engine.paused, upcoming: [], error: null, ended: !!durationMs && positionMs >= durationMs, trimEndMs: null }
}

const shot = new URLSearchParams(location.search)

// Listen together: an invented room, led here or joined (no network: two invented friends, one invented host).
const ROOM_OFF: RoomStatus = { role: 'off', room: '', host: '', people: [], code: null, link: null, qr: null, now: null, next: [] }
let room: RoomStatus = ROOM_OFF
const FRIENDS = ['Pixel 8', 'Léa’s laptop']
function roomSet(next: RoomStatus) {
  room = next
  emit('room', { kind: 'state' })
}
/** A QR's look, not a real one (nothing to scan in the demo): three finder squares, the rest invented. */
function fakeQr(n = 25): [number, string] {
  const finder = (x: number, y: number) => {
    const m = Math.max(Math.abs(x - 3), Math.abs(y - 3))
    return m <= 3 && m !== 2
  }
  let bits = ''
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const f = x < 8 && y < 8 ? finder(x, y) : x >= n - 8 && y < 8 ? finder(x - (n - 7), y) : x < 8 && y >= n - 8 ? finder(x, y - (n - 7)) : null
      bits += (f ?? (x * 7 + y * 13 + x * y) % 5 < 2) ? '1' : '0'
    }
  return [n, bits]
}
function roomStart(): RoomStatus {
  roomSet({ ...ROOM_OFF, role: 'host', room: 'This PC', host: 'This PC', people: FRIENDS, code: '042917', qr: fakeQr() })
  // A friend's reaction, a moment after (the float over the cover).
  setTimeout(() => room.role === 'host' && emit('room', { kind: 'react', from: FRIENDS[0], reaction: 'fire' }), 1800)
  return room
}
function roomJoin(): RoomStatus {
  const t = TRACKS[(OPENING + 3) % TRACKS.length]
  const song = { title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs, isrc: null, youtube: null, spotify: null, art: null }
  roomSet({ ...ROOM_OFF, role: 'listener', room: 'Living room', host: 'Living room PC', people: ['This PC', FRIENDS[1]], now: { song, positionMs: 42_000, playing: true, at: Date.now(), seq: 1 } })
  return room
}

// Sign in with Plex: each sign-in (and Cancel) moves it on, so an older wait stops.
let plexRound = 0

const ANSWERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  room_status: () => room,
  room_start: () => roomStart(),
  room_end: () => roomSet(ROOM_OFF),
  room_leave: () => roomSet(ROOM_OFF),
  room_host_now: () => null,
  room_host_next: () => null,
  room_react: () => null,
  rooms_nearby: () => new Promise((done) => setTimeout(() => done([{ id: '0123456789abcdef', room: 'Living room', host: 'Living room PC', people: 1, full: false }]), 900)),
  room_join: () => roomJoin(),
  // The listener's own library has it: the room's song plays from it.
  room_resolve: ({ song }) => {
    const t = TRACKS.find((x) => x.title === (song as { title: string }).title)
    return t ? { kind: 'library', id: t.id } : { kind: 'missing' }
  },
  library: () => ({ tracks: TRACKS, playlists: PLAYLISTS, orders: Object.fromEntries(PLAYLISTS.map((p) => [p.id, inList(p.id).map((t) => t.id)])) }),
  library_changes: () => null,
  // Picture-in-picture: the page stays as it is, no window to shrink.
  pip: () => null,
  playlist_tracks: ({ id }) => inList(id as number),
  sources_status: () => [['spotify', { configured: true, connected: true }], ['youtube', { configured: true, connected: true }]],
  // The app's first window, a little less sidebar: titles read whole.
  // The page's language (?lang=, from the site's other languages): the interface speaks it too.
  load_settings: () => ({ defaultsVersion: 9, welcomed: true, language: shot.get('lang') ?? 'en', reopen: false, startView: 'songs', songSort: 'added-old', columns: ['album', 'sources', 'duration'], sidebarWidth: 240, theme: shot.get('theme') ?? 'system' }),
  load_session: () => ({ ids: TRACKS.map((t) => t.id), remote: [], index: OPENING, order: ORDER, added: ADDED, shuffle: false, repeat: 'off', positionMs: 84_000, via: 'local', volume: 0.8, paused: true }),
  update_status: () => ({ current: 'demo', lastCheck: null, lastUpdate: null, justUpdated: true, state: 'idle' }),
  player: ({ cmd }) => player(cmd as PlayerCommand),
  player_status: status,
  search_catalogs: search,
  search_lyrics: sung,
  // Not started from the taskbar.
  jump_pending: () => null,
  bookmarks: ({ trackId }) => marksOf(trackId),
  add_bookmark: addMark,
  delete_bookmark: dropMark,
  lyrics,
  viz_start: ({ frames, fine, wave }) => startFrames(frames as Frames, fine === true, wave === true),
  player_levels: levels,
  viz_stop: stopFrames,
  // A made-up song's shape for the seek bar: a quiet start, verses and louder choruses, a fade out.
  local_waveform: () => Array.from({ length: 400 }, (_, i) => Math.round(Math.min(255, 40 + 150 * Math.min(1, i / 30, (400 - i) / 40) * (i % 120 > 60 ? 1.2 : 0.9) + 25 * Math.abs(Math.sin(i * 0.9))))),
  play_stats: () => Object.fromEntries(PLAYS.map((p) => [p.trackId, [PLAYS.filter((x) => x.trackId === p.trackId).length, p.startedAt]])),
  recent_plays: ({ since }) => PLAYS.filter((p) => p.startedAt >= (since as number)),
  play_history: () => PLAYS,
  mixes: () => MIXES,
  system_accent: () => null,
  autostart: () => false,
  ytm_home: () => ({ shelves: [], moods: [] }),
  shield_status: () => ({ enabled: false, blocked: 0 }),
  edit_draft: () => null,
  // Settings: nothing set up.
  ytm_accounts: () => ({ signedIn: false, accounts: [], picked: [] }),
  sync_status: () => ({ onedrive: [], folder: null, protected: false, asked: false, deviceName: 'This PC', devices: [], last: null, error: null }),
  sync_directions: () => ({}),
  // Sync Mode › Your devices: two invented ones, one here (an empty answer broke the page).
  devices_status: () => ({
    network: true,
    auto: true,
    name: 'This PC',
    os: 'windows',
    form: 'tower',
    rows: [
      { id: 'demo-laptop', name: 'Study laptop', os: 'windows', form: 'laptop', trusted: true, here: true, offering: false, synced: Date.now() - 12 * 60_000, refused: false },
      { id: 'demo-phone', name: 'Phone', os: 'android', form: 'phone', trusted: true, here: false, offering: false, synced: Date.now() - 26 * 3_600_000, refused: false },
    ],
    offer: null,
    error: null,
  }),
  lastfm_status: () => ({ configured: false, user: null, waiting: 0 }),
  // Your music server: none signed in; the address field's warning as Rust would say it (`music_core::server::exposure`).
  server_status: () => [],
  server_exposure: ({ address }) => {
    const a = String(address).trim().toLowerCase()
    if (!a) return null
    const host = a.replace(/^https?:\/\//, '').split(/[/:]/)[0]
    const local = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/.test(host) || !host.includes('.') || /\.(local|lan|home|internal)$/.test(host)
    return a.startsWith('https://') ? 'secure' : local ? 'local' : a.startsWith('http://') ? 'open' : 'secure'
  },
  // Sign in with Plex: an invented code, then two invented servers after a few seconds (as if the user had signed in on
  // Plex's page); Cancel stops the wait. Picking one needs a real server: refused below.
  plex_sign_in: () => {
    plexRound++
    return { code: 'DEMO7Q2KXW4P9M3RT6VB', expiresInS: 900, authUrl: 'https://app.plex.tv/auth' }
  },
  plex_wait: () => {
    const round = plexRound
    return new Promise((done, fail) =>
      setTimeout(() => (round === plexRound ? done([{ id: 'demo-attic', name: 'Attic NAS', owned: true }, { id: 'demo-friend', name: 'Sam’s server', owned: false }]) : fail(new Error('Sign-in with Plex cancelled'))), 5000),
    )
  },
  plex_cancel: () => {
    plexRound++
    return null
  },
  discord_status: () => ({ connected: false, error: null }),
  nearby_status: () => ({ state: 'idle' }),
  cache_stats: () => Object.fromEntries(['library', 'playlists', 'mixes', 'stats', 'images'].map((k) => [k, { hits: 0, misses: 0, entries: 0, bytes: 0 }])),
  art_cache_size: () => 0,
  storage: () => ({ library: 0, covers: 0, caches: 0, log: 0, webview: null }),
  detector_status: () => false,
  spotify_web_status: () => false,
}

// What needs an account, the network or the PC: said plainly, never faked.
const REFUSED = new Set(['add_link', 'add_to_youtube', 'add_track', 'album_info', 'alternative_videos', 'clear_art_cache', 'clear_history', 'clear_storage', 'connect', 'detect_song', 'disconnect', 'edit_tags', 'export_cover', 'export_edit', 'export_theme', 'export_youtube', 'find_versions', 'import_link', 'import_song_list', 'import_spotify_link', 'import_theme', 'lastfm_connect', 'merge_duplicates', 'nearby_receive', 'nearby_send', 'open_licenses', 'open_windows_settings', 'play_preview', 'plex_pick', 'plugin_install', 'rescan_local', 'resolve_track', 'restart_app', 'save_background', 'save_cover', 'server_scrobble', 'server_sign_in', 'server_sign_out', 'server_star', 'server_sync', 'set_local_folders', 'share_import', 'share_playlist', 'share_preview', 'share_read_image', 'spotify_export_open', 'spotify_import', 'spotify_web_open', 'sync_all', 'sync_join', 'sync_now', 'sync_offer', 'sync_setup', 'update_check', 'update_install', 'voice_listen', 'ytm_artist', 'ytm_list', 'ytm_sign_in', 'ytm_sign_out', 'ytwatch_open'])

/** What Rust would say; a list, for all the commands no screen here reads. */
export function answer(cmd: string, args: Record<string, unknown>) {
  if (REFUSED.has(cmd)) throw new Error('Not in this demo: install Legato for that')
  return (ANSWERS[cmd] ?? (() => []))(args)
}
