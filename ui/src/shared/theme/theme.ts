/** Hi-Fi themes: palettes, user settings schema, contrast check. Applied as CSS variables (styles.css @theme). */
import { LANGUAGES, msg, tr } from '../i18n/i18n'
import { ACTIONS, validCombo, type Custom } from '../../app/keys'
import { cleanCss } from '../css'
import type { GroupSort, Sort } from '../../features/library/filter'

export const PALETTE_KEYS = ['bg', 'panel', 'raised', 'recess', 'line', 'lineSoft', 'ink', 'ink2', 'ink3', 'ink4', 'accent', 'onAccent', 'ledOff'] as const
export type PaletteKey = (typeof PALETTE_KEYS)[number]
export type Palette = Record<PaletteKey, string>

export interface Theme extends Palette {
  id: string
  name: string
  dark: boolean
  font: Font
  glow: boolean
  /** Corner roundness of panels, buttons, cards. */
  radius: Radius
  /** Picture behind the whole window (covers/ file `bg-…`), surfaces see-through over it. */
  background?: Background
  /** Appearance choices the theme brings when picked (cover shape, density, player…). */
  look?: Look
  /** Advanced: the theme's own CSS (cleaned; Music App's name, logo and legal notices stay). */
  css?: string
}

export const RADII = ['sharp', 'soft', 'round'] as const
export type Radius = (typeof RADII)[number]

export const FITS = ['cover', 'contain', 'tile'] as const
export interface Background {
  image: string
  fit: (typeof FITS)[number]
  /** Theme background color over the picture, 0..90 %. */
  dim: number
  /** Picture blur, px. */
  blur: number
  /** Surfaces' opacity over the picture, 40..100 %. */
  panels: number
}

/** Settings a theme can bring along ("parts of the UX"). */
export const LOOK_KEYS = ['covers', 'density', 'readout', 'volume', 'tuner', 'tint', 'appTint', 'immersive', 'backdropBlur', 'backdropDim', 'backdropMotion', 'motion', 'sidebarCounts', 'listCovers', 'columns'] as const
export type LookKey = (typeof LOOK_KEYS)[number]
export type Look = Partial<Pick<Settings, LookKey>>

/** Theme CSS kept in settings (synced, size-bounded): 20 KB. */
export const MAX_THEME_CSS = 20_000

/** modern = Roboto (YouTube's UI font), hifi = Schibsted Grotesk, neutral = Segoe UI. */
export const FONTS = ['modern', 'hifi', 'neutral'] as const
export type Font = (typeof FONTS)[number]

const preset = (id: string, name: string, dark: boolean, p: Palette, font: Font = 'hifi', glow = true): Theme => ({ id, name, dark, font, glow, radius: 'soft', ...p })

// ink3 values tuned for WCAG AA (4.5:1) on bg, panels and cards (raised).
export const PRESETS: Theme[] = [
  // v2 (docs/design.md, 2026-10-29): Roboto, layered greys (window recess, panels, main bg), sky blue = playback.
  preset('modern', 'Modern', false, { bg: '#FFFFFF', panel: '#F7F7F5', raised: '#EFEFEC', recess: '#E6E6E3', line: '#DEDEDA', lineSoft: '#ECECE9', ink: '#0F0F0F', ink2: '#565656', ink3: '#606060', ink4: '#A8A8A8', accent: '#7CB8FF', onAccent: '#0F0F0F', ledOff: '#D2D2CE' }, 'modern', false),
  preset('modern-dark', 'Modern Dark', true, { bg: '#131313', panel: '#171717', raised: '#232323', recess: '#050505', line: '#2C2C2C', lineSoft: '#1E1E1E', ink: '#F1F1F1', ink2: '#B3B3B3', ink3: '#8C8C8C', ink4: '#4A4A4A', accent: '#7CB8FF', onAccent: '#0F0F0F', ledOff: '#3A3A3A' }, 'modern', false),
  preset('paper', 'Paper', false, { bg: '#F3F1EC', panel: '#EAE7E0', raised: '#FBFAF7', recess: '#E1DDD4', line: '#D6D1C6', lineSoft: '#E4E0D7', ink: '#171614', ink2: '#5C5852', ink3: '#6B665E', ink4: '#B2ACA1', accent: '#FF5A1F', onAccent: '#FFFFFF', ledOff: '#CDC7BB' }),
  preset('graphite', 'Graphite', true, { bg: '#121211', panel: '#1A1A18', raised: '#24231F', recess: '#0B0B0A', line: '#302F2B', lineSoft: '#252421', ink: '#EDEAE4', ink2: '#A6A198', ink3: '#948E85', ink4: '#55524C', accent: '#FF6A2E', onAccent: '#171614', ledOff: '#3A3935' }),
  preset('studio', 'Studio', true, { bg: '#000000', panel: '#0A0A0A', raised: '#161616', recess: '#000000', line: '#262626', lineSoft: '#1A1A1A', ink: '#FFFFFF', ink2: '#A3A3A3', ink3: '#858585', ink4: '#4D4D4D', accent: '#FF3B30', onAccent: '#FFFFFF', ledOff: '#333333' }),
  preset('aluminum', 'Aluminum', false, { bg: '#ECEEF0', panel: '#E1E4E8', raised: '#F7F8F9', recess: '#D7DBE0', line: '#C9CED5', lineSoft: '#DADEE3', ink: '#14171A', ink2: '#4E5660', ink3: '#5D656F', ink4: '#A4ACB5', accent: '#2F6FEB', onAccent: '#FFFFFF', ledOff: '#BFC5CC' }),
  preset('bakelite', 'Bakelite', true, { bg: '#1C1410', panel: '#241A14', raised: '#2E221A', recess: '#140E0B', line: '#3D2E24', lineSoft: '#2E231B', ink: '#F2E6D3', ink2: '#BFAE95', ink3: '#9E8E77', ink4: '#5E5244', accent: '#F2A900', onAccent: '#1C1410', ledOff: '#4A3B2F' }),
  preset('sage', 'Sage', false, { bg: '#E7ECE6', panel: '#DCE3DA', raised: '#F4F7F3', recess: '#D1D9CF', line: '#C2CCBF', lineSoft: '#D5DDD2', ink: '#152019', ink2: '#4C5B50', ink3: '#58675B', ink4: '#A0ADA2', accent: '#1F7A4D', onAccent: '#FFFFFF', ledOff: '#B8C3B6' }),
]

export const ACCENTS = ['#FF5A1F', '#E5383B', '#F2B705', '#2E8B57', '#2F6FEB', '#171614']

export const COLUMNS = ['album', 'sources', 'plays', 'added', 'duration'] as const
/** List sorts (features/library/filter): checked on load. */
const SORTS: readonly Sort[] = ['manual', 'added-new', 'added-old', 'most-played', 'recently-played', 'title', 'title-desc', 'artist', 'album', 'duration', 'duration-short', 'random', 'recent']
const GROUP_SORTS: readonly GroupSort[] = ['name', 'name-desc', 'artist', 'songs', 'albums', 'added-new', 'added-old', 'most-played', 'recently-played', 'length', 'random']

/** Home's sections, default order. */
export const HOME_SECTIONS = ['quick', 'week', 'mixes', 'recent', 'playlists', 'youtube', 'added'] as const
/** Off until turned on: the sidebar lists your playlists already (user's pick 2026-10-23). */
const HOME_OFF: readonly HomeSectionId[] = ['playlists']
export const PLAYLIST_ORDERS = ['custom', 'name', 'songs', 'opened'] as const
export type PlaylistOrder = (typeof PLAYLIST_ORDERS)[number]
/** Home's chips: everything, your library only, YouTube Music only (remembered). */
export const HOME_FILTERS = ['all', 'library', 'youtube'] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]
export type HomeSectionId = (typeof HOME_SECTIONS)[number]
export interface HomeSection {
  id: HomeSectionId
  on: boolean
}

/** Saved Home layout → every known section once, in the saved order, ones added since at their default place. */
/** Smart playlist rule: a song field, a test, a value (numbers as text, like a form field). */
export const SMART_FIELDS = ['artist', 'album', 'title', 'source', 'plays', 'played', 'added'] as const
export type SmartField = (typeof SMART_FIELDS)[number]
export interface SmartRule {
  field: SmartField
  /** artist / album / title: has, is, not · source: is, not · plays: atLeast, atMost · played: within, notWithin · added: last */
  op: string
  value: string
}
export const SMART_SORTS = ['plays', 'recent', 'added', 'title', 'artist', 'random'] as const
/** A playlist that fills itself from rules (kept in settings: synced with Sync Mode, nothing in the library). */
export interface SmartList {
  id: string
  name: string
  match: 'all' | 'any'
  rules: SmartRule[]
  sort: (typeof SMART_SORTS)[number]
  /** Songs at most; 0 = all. */
  limit: number
}

export function sanitizeSmart(raw: unknown): SmartList[] {
  const lists = Array.isArray(raw) ? raw : []
  return lists.flatMap((l): SmartList[] => {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || typeof l.name !== 'string') return []
    const rules = (Array.isArray(l.rules) ? l.rules : []).filter((r: SmartRule) => r && SMART_FIELDS.includes(r.field) && typeof r.op === 'string' && typeof r.value === 'string')
    return [{ id: l.id, name: l.name.slice(0, 200), match: l.match === 'any' ? 'any' : 'all', rules, sort: SMART_SORTS.includes(l.sort) ? l.sort : 'plays', limit: Number.isInteger(l.limit) && l.limit > 0 ? Math.min(l.limit, 10_000) : 0 }]
  })
}

export function sanitizeHome(raw: unknown): HomeSection[] {
  const saved = (Array.isArray(raw) ? raw : []).filter((x): x is HomeSection => !!x && typeof x === 'object' && HOME_SECTIONS.includes((x as HomeSection).id))
  const out: HomeSection[] = []
  for (const x of saved) if (!out.some((y) => y.id === x.id)) out.push({ id: x.id, on: x.on !== false })
  HOME_SECTIONS.forEach((id, i) => {
    if (out.some((y) => y.id === id)) return
    const before = HOME_SECTIONS.slice(0, i).findLast((b) => out.some((y) => y.id === b))
    out.splice(before ? out.findIndex((y) => y.id === before) + 1 : 0, 0, { id, on: !HOME_OFF.includes(id) })
  })
  return out
}

/** Home section `id` one place up (-1) or down (1). */
export function moveHome(list: HomeSection[], id: HomeSectionId, d: 1 | -1): HomeSection[] {
  const i = list.findIndex((x) => x.id === id)
  const j = i + d
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Home section `id` dropped at slot `slot` (before the section there, list.length = last): Customize Home's drag. */
export function placeHome(list: HomeSection[], id: HomeSectionId, slot: number): HomeSection[] {
  const i = list.findIndex((x) => x.id === id)
  const to = slot > i ? slot - 1 : slot
  if (i < 0 || to === i || to < 0 || to >= list.length) return list
  const out = list.filter((x) => x.id !== id)
  out.splice(to, 0, list[i])
  return out
}
export type Column = (typeof COLUMNS)[number]

export const START_VIEWS = ['home', 'songs', 'mixes', 'albums', 'artists'] as const
/** Where notifications show: above the player bar (centered or right), or under the top bar. */
export const TOAST_PLACES = ['bottom', 'bottomRight', 'top', 'topRight'] as const

/** Mini player resting spots: corners and edge middles (t = top, b = bottom, l = left, r = right). */
/** Playlist icon: service logo, first song's cover, grid of the first 4, or a picked image. */
export const COVER_MODES = ['source', 'first', 'grid', 'image'] as const
/** Visualizer.tsx looks: bars from the bottom, mirrored from the middle, bars with falling peaks, a wave. */
export const VISUALIZER_STYLES = ['bars', 'mirror', 'peaks', 'wave'] as const
export type VisualizerStyle = (typeof VISUALIZER_STYLES)[number]
/** Order the cover songs are taken in: the playlist's own, or a library sort. */
export const COVER_ORDERS = ['playlist', 'recent', 'title', 'artist', 'album', 'duration'] as const
export interface PlaylistCover {
  mode: (typeof COVER_MODES)[number]
  order: (typeof COVER_ORDERS)[number]
  /** covers/ file name (mode image). */
  image?: string
}

export const SPOTS = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const

/** Text size → root font scale. Compact = the sizes before 2026-10-22 (13 px body); normal ≈ 14 px body. */
export const TEXT_SCALES = { compact: 1, normal: 1.08, large: 1.17 } as const
export type TextSize = keyof typeof TEXT_SCALES
export type Spot = (typeof SPOTS)[number]

/** The app's own Discord application (public id, not a secret): its name shows after "Listening to". */
export const DISCORD_APP = '1560758371064221839'

/** Discord Rich Presence add-on. appId = the app's Discord application, or the user's own. */
export interface DiscordSettings {
  appId: string
  /** After "Listening to" in the member list: the application's name, the artist or the song. */
  status: 'name' | 'artist' | 'song'
  /** Button to the song's page (YouTube, Spotify, Apple Music). */
  buttons: boolean
  /** Keep the song up while paused (no progress bar). */
  paused: boolean
  /** "Get App On GitHub" button. */
  github: boolean
}

/** Bumped when defaults change for everyone (saved settings get the new ones once). */
const DEFAULTS_VERSION = 8

/** Adaptive Sound targets, LUFS: Quiet, Normal (streaming services' usual level), Loud. */
export const ADAPTIVE_LEVELS = [-20, -14, -11] as const
export type AdaptiveLevel = (typeof ADAPTIVE_LEVELS)[number]

/** Fade shapes, as audio editors name them. */
export const FADE_CURVES = ['scurve', 'linear', 'equal', 'exp', 'log'] as const
export type FadeCurve = (typeof FADE_CURVES)[number]

/** Advanced fade (Settings › Advanced). Off: the simple "Fade between songs" seconds, S-curve both ways. */
export interface FadeSettings {
  advanced: boolean
  /** Seconds, 0–12. */
  out: number
  in: number
  outCurve: FadeCurve
  inCurve: FadeCurve
  /** Songs you pick yourself fade in too. */
  skip: boolean
  /** Fade on pause and play, ms (0 = off). */
  pause: number
}

export interface Settings {
  /** Interface language: 'system' (Windows', English if not offered) or a code from shared/i18n. */
  language: string
  /** Preset id, custom theme id, or 'system' (Modern / Modern Dark, following Windows). */
  theme: string
  /** Hex overrides theme accent; 'system' = Windows accent; null = theme's own (sky blue in v2). */
  accent: string | null
  customThemes: Theme[]
  covers: 'net' | 'rounded' | 'vinyl'
  density: 'compact' | 'comfort' | 'airy'
  /** Text only (rem sizes), apart from the interface zoom. */
  textSize: TextSize
  /** Webview zoom, percent. */
  zoom: number
  readout: boolean
  /** Moon (sleep timer) next to the volume; the timer stays in the player's menu. */
  sleepButton: boolean
  volume: 'knob' | 'bar'
  tuner: boolean
  columns: Column[]
  /** Sorts picked on the list pages (remembered: Spotify's library kept going back to Recent). */
  songSort: Sort
  playlistSort: Sort
  albumSort: GroupSort
  artistSort: GroupSort
  /** Ad/tracker blocker (read by Rust at launch). */
  shield: boolean
  /** Floating mini player for every source (YouTube always shows one: its video must stay visible). */
  miniPlayer: boolean
  /** Now Playing takes a flat tint from the cover. */
  tint: boolean
  /** The whole app takes that tint while a song plays. */
  appTint: boolean
  /** Now Playing over the song's cover, big and blurred (tint used when off). */
  immersive: boolean
  /** Immersive background: blur in screen px (0–80), veil strength % (0–80), slow drift. */
  backdropBlur: number
  backdropDim: number
  backdropMotion: boolean
  /** 'theme' = the theme's own font. */
  font: 'theme' | Font
  /** Transitions and animations. */
  motion: boolean
  /** Track counts next to sidebar entries. */
  sidebarCounts: boolean
  /** Covers in track lists. */
  listCovers: boolean
  /** A single click on a track row plays it, or a double-click does. */
  clickToPlay: 'single' | 'double'
  startView: (typeof START_VIEWS)[number]
  /** YouTube's own buttons and title on the video (applies from the next track). */
  youtubeControls: boolean
  /** Now Playing with YouTube: video, cover (video transparent), or auto: cover when the video is a still image. */
  stage: 'auto' | 'video' | 'cover'
  miniSpot: Spot
  /** Where the mini player sits: top of the right panel, bottom of the sidebar (neither over the content) or floating. */
  miniPlace: 'panel' | 'sidebar' | 'float'
  /** Mini player width, px (video 16:9 below it, 200 px tall at least). */
  miniWidth: number
  /** Fade between songs, seconds (0 = off). */
  crossfade: number
  /** Songs longer than this many minutes skipped as the queue moves on (0 = off). */
  skipLong: number
  fade: FadeSettings
  /** YouTube subtitles (off: hidden even when the Google account turns them on). */
  subtitles: boolean
  /** Playlists left out of the sidebar and menus (playlistKey), still in the library. */
  hiddenPlaylists: string[]
  /** Lyrics timing fixed by hand, per song (effects.ts songKey): song time = lyric time × rate + offset (ms). */
  lyricsSync: Record<string, { offset: number; rate: number }>
  /** Sidebar's playlist order: as imported / made, A–Z, most songs, opened lately (remembered). */
  playlistOrder: PlaylistOrder
  /** Home: which sections show, in what order. */
  homeSections: HomeSection[]
  homeFilter: HomeFilter
  smartLists: SmartList[]
  /** Per playlist (playlistKey). Missing = service logo in the sidebar, first cover on its page. */
  playlistCovers: Record<string, PlaylistCover>
  /** Mixes page: 4 song covers, the first one, or the plain numbered tile. */
  mixCovers: 'grid' | 'single' | 'template'
  /** Download updates in the background and install them when nothing plays. */
  autoUpdate: boolean
  /** Now Playing: Up next panel open (off: the title big beside the cover, docs/design.md). */
  upNext: boolean
  /** Main window's right panel, beside every page: Up next, lyrics, or closed. Apart from Now Playing's. */
  sidePanel: 'upNext' | 'lyrics' | 'none'
  /** Notifications (app/Toasts): where, which (important = errors and those with a button), how long. */
  toastPlace: (typeof TOAST_PLACES)[number]
  toastShow: 'all' | 'important'
  toastTime: 'short' | 'normal' | 'long'
  /** Now Playing: lyrics beside the cover (wins over Up next). */
  lyrics: boolean
  /** Now Playing: Live Editor beside the cover (wins over lyrics and Up next). */
  editor: boolean
  /** Pick up the last track where it stopped when the app opens. */
  resume: boolean
  /** Open on the screen the app was closed on, Now Playing included (startView when off). */
  reopen: boolean
  /** Closing the window keeps the app in the notification area (Rust reads it, background.rs). Quit really quits. */
  closeToTray: boolean
  /** Adaptive Sound: loud and quiet songs evened out as they play (crates/dsp, live.js). Target in LUFS. */
  adaptiveSound: boolean
  adaptiveLevel: AdaptiveLevel
  /** Now Playing's cover moves with the music's loudness. */
  coverPulse: boolean
  /** Now Playing shows the music as moving bars (16 bands, crates/dsp spectrum.rs). */
  visualizer: boolean
  visualizerStyle: VisualizerStyle
  /** Videos whose song ends before the video (silence, end screen): the next song starts at the song's end (ends.ts). */
  earlyEnds: boolean
  /** YouTube's sound may go through the processing above (off: untouched, features work on local files only). */
  liveYoutube: boolean
  /** Voice search agreed to (Windows' online speech recognition: the voice goes to Microsoft while the mic listens). */
  voiceSearch: boolean
  /** Up next ran out: similar songs follow (YouTube Music's radio, or your library). */
  autoplay: boolean
  /** Top bar lists recent searches (kept on this PC only: localStorage, never synced). */
  rememberSearches: boolean
  /** Top bar asks YouTube's suggestions as you type (the text goes to Google). */
  searchSuggestions: boolean
  /** Now Playing: the top bar's search sits over the cover / video, not the window's middle. */
  searchOnCover: boolean
  /** Music Detector agreed to (microphone, 10 s clips sent to AudD to name the song). */
  detector: boolean
  /** Music Detector source: the microphone, or what this PC plays. */
  detectorInput: 'mic' | 'pc'
  /** This PC's sound allowed for the Music Detector (asked once, apart from the microphone). */
  detectorPc: boolean
  /** Add-ons turned on (id → on). All off until the user turns them on. */
  addons: Record<string, boolean>
  discord: DiscordSettings
  /** Keyboard shortcuts changed in Settings › Shortcuts (app/keys.ts): null = removed, absent = default. */
  shortcuts: Custom
  defaultsVersion: number
}

export const DEFAULTS: Settings = {
  language: 'system',
  theme: 'system',
  accent: null,
  customThemes: [],
  covers: 'net',
  density: 'compact',
  textSize: 'normal',
  zoom: 100,
  readout: true,
  sleepButton: true,
  volume: 'bar',
  tuner: false,
  // Date added on demand (unknown for songs added before 2026-10-23).
  columns: COLUMNS.filter((c) => c !== 'added'),
  songSort: 'artist',
  playlistSort: 'manual',
  albumSort: 'name',
  artistSort: 'name',
  shield: true,
  miniPlayer: false,
  tint: true,
  appTint: false,
  immersive: false,
  backdropBlur: 24,
  backdropDim: 40,
  backdropMotion: true,
  font: 'theme',
  motion: true,
  sidebarCounts: true,
  // Covers on every song row, compact too (user's pick 2026-10-29, over the mockup's coverless compact rows).
  listCovers: true,
  clickToPlay: 'single',
  startView: 'home',
  youtubeControls: false,
  stage: 'auto',
  miniSpot: 'br',
  miniPlace: 'panel',
  miniWidth: 356,
  crossfade: 2,
  skipLong: 0,
  fade: { advanced: false, out: 2, in: 2, outCurve: 'scurve', inCurve: 'scurve', skip: true, pause: 0 },
  subtitles: false,
  hiddenPlaylists: [],
  lyricsSync: {},
  playlistOrder: 'custom',
  homeSections: HOME_SECTIONS.map((id) => ({ id, on: !HOME_OFF.includes(id) })),
  smartLists: [],
  homeFilter: 'all',
  playlistCovers: {},
  mixCovers: 'grid',
  autoUpdate: true,
  upNext: false,
  sidePanel: 'upNext',
  toastPlace: 'bottom',
  toastShow: 'all',
  toastTime: 'normal',
  lyrics: false,
  editor: false,
  resume: true,
  reopen: true,
  closeToTray: true,
  adaptiveSound: false,
  adaptiveLevel: -14,
  coverPulse: false,
  visualizer: false,
  visualizerStyle: 'bars',
  earlyEnds: true,
  liveYoutube: true,
  voiceSearch: false,
  autoplay: true,
  rememberSearches: true,
  searchSuggestions: true,
  searchOnCover: true,
  detector: false,
  detectorInput: 'mic',
  detectorPc: false,
  addons: {},
  discord: { appId: DISCORD_APP, status: 'song', buttons: true, paused: false, github: true },
  shortcuts: {},
  defaultsVersion: DEFAULTS_VERSION,
}

/** Defaults changed in version 2 (user's request 2026-10-16): YouTube-like bar and volume, one-click play. */
const V2: Partial<Settings> = { volume: 'bar', tuner: false, clickToPlay: 'single' }
/** Version 3: Now Playing picks video or cover by itself. */
const V3: Partial<Settings> = { stage: 'auto' }

/** Version 4 (2026-10-17): the new Home opens first. */
const V4: Partial<Settings> = { startView: 'home' }

/** Version 8 (app v2 redesign, docs/design.md): old defaults move to the new ones, picks of their own stay. */
function v8(r: Record<string, unknown>): Partial<Settings> {
  const compact = (r.density ?? 'comfort') === 'comfort'
  return {
    ...(r.accent === 'system' && { accent: null }),
    ...(compact && { density: 'compact' }),
    ...((r.covers ?? 'rounded') === 'rounded' && { covers: 'net' }),
    immersive: false,
    upNext: false,
    // Sidebar = library only (user's pick 2026-10-29): YouTube's video goes to the right panel.
    ...(r.miniPlace !== 'float' && { miniPlace: 'panel' }),
  }
}

/** Version 6 (Home v4, 2026-10-23): Your playlists off (see HOME_OFF), applied below. */

/** Version 5 (user's picks 2026-10-22): mini player in the sidebar, bigger text; 2 s fades instead of 5 for those who
 * never changed them. */
function v5(r: Record<string, unknown>): Partial<Settings> {
  const f = (r.fade ?? {}) as Record<string, unknown>
  const untouched = (r.crossfade ?? 5) === 5 && (f.out ?? 5) === 5 && (f.in ?? 5) === 5 && f.advanced !== true
  return { miniPlace: 'sidebar', textSize: 'normal', ...(untouched && { crossfade: 2, fade: { ...sanitizeFade(r.fade), out: 2, in: 2 } }) }
}

const HEX = /^#[0-9a-f]{6}$/i
/** Background file names as `save_background` writes them. */
const BG_NAME = /^bg-[0-9a-f]{16}\.(png|jpg|webp|gif|mp4|webm)$/
/** A background that plays (muted, looped) instead of a picture. */
export const isVideo = (name: string) => /\.(mp4|webm)$/.test(name)
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback)
const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)

/** Trust boundary (file import, stored JSON): full palette or nothing. */
export function sanitizeTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!PALETTE_KEYS.every((k) => isHex(r[k]))) return null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : tr('My theme')
  const id = typeof r.id === 'string' && /^custom-[\w-]{1,40}$/.test(r.id) ? r.id : `custom-${Date.now().toString(36)}`
  const palette = Object.fromEntries(PALETTE_KEYS.map((k) => [k, (r[k] as string).toUpperCase()])) as Palette
  const b = r.background && typeof r.background === 'object' ? (r.background as Record<string, unknown>) : null
  const background: Background | undefined =
    b && typeof b.image === 'string' && BG_NAME.test(b.image) ? { image: b.image, fit: pick(b.fit, FITS, 'cover'), dim: num(b.dim, 0, 90, 30), blur: num(b.blur, 0, 40, 0), panels: num(b.panels, 40, 100, 80) } : undefined
  const look = sanitizeLook(r.look)
  const css = cleanCss(r.css, MAX_THEME_CSS).trim()
  return {
    id,
    name,
    dark: luminance(palette.bg) < 0.2,
    font: pick(r.font, FONTS, 'hifi'),
    glow: r.glow !== false,
    radius: pick(r.radius, RADII, 'soft'),
    ...palette,
    ...(background && { background }),
    ...(look && { look }),
    ...(css && { css }),
  }
}

/** A theme's look: known keys only, each checked like a setting. */
function sanitizeLook(raw: unknown): Look | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const given = LOOK_KEYS.filter((k) => k in (raw as object))
  if (!given.length) return undefined
  // Current defaults version: no defaults migration on a look.
  const clean = sanitize({ ...(raw as object), defaultsVersion: DEFAULTS_VERSION })
  return Object.fromEntries(given.map((k) => [k, clean[k]])) as Look
}

/** The look settings as they are now (to save into a theme). */
export const lookOf = (s: Settings): Look => Object.fromEntries(LOOK_KEYS.map((k) => [k, s[k]])) as Look

/** Preset ids before English rename. */
const LEGACY_IDS: Record<string, string> = { papier: 'paper', aluminium: 'aluminum', sauge: 'sage' }

/** Saved shortcut changes: known actions, well-formed combos or null (removed). */
function sanitizeShortcuts(raw: unknown): Custom {
  if (!raw || typeof raw !== 'object') return {}
  const out: Custom = {}
  for (const a of ACTIONS) {
    const v = (raw as Record<string, unknown>)[a.id]
    if (!v || typeof v !== 'object') continue
    const pick = (c: unknown) => (c === null ? null : validCombo(c) ? c : undefined)
    const keys = pick((v as { keys?: unknown }).keys)
    const global = pick((v as { global?: unknown }).global)
    if (keys !== undefined || global !== undefined) out[a.id] = { ...(keys !== undefined && { keys }), ...(global !== undefined && { global }) }
  }
  return out
}

export function sanitize(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const customThemes = (Array.isArray(r.customThemes) ? r.customThemes : []).slice(0, 24).map(sanitizeTheme).filter((t): t is Theme => !!t)
  const ids = ['system', ...PRESETS.map((t) => t.id), ...customThemes.map((t) => t.id)]
  const saved = typeof r.defaultsVersion === 'number' ? r.defaultsVersion : 0
  const columns = Array.isArray(r.columns) ? [...new Set(r.columns.filter((c): c is Column => COLUMNS.includes(c as Column)))] : DEFAULTS.columns
  return {
    language: typeof r.language === 'string' && (r.language === 'system' || LANGUAGES.some((l) => l.code === r.language)) ? r.language : DEFAULTS.language,
    theme: pick(LEGACY_IDS[r.theme as string] ?? r.theme, ids, DEFAULTS.theme),
    accent: isHex(r.accent) ? r.accent.toUpperCase() : r.accent === null || r.accent === 'system' ? r.accent : DEFAULTS.accent,
    customThemes,
    covers: pick(r.covers, ['net', 'rounded', 'vinyl'] as const, DEFAULTS.covers),
    density: pick(r.density, ['compact', 'comfort', 'airy'] as const, DEFAULTS.density),
    textSize: pick(r.textSize, Object.keys(TEXT_SCALES) as TextSize[], DEFAULTS.textSize),
    zoom: typeof r.zoom === 'number' && Number.isFinite(r.zoom) ? Math.min(125, Math.max(90, Math.round(r.zoom / 5) * 5)) : DEFAULTS.zoom,
    readout: typeof r.readout === 'boolean' ? r.readout : DEFAULTS.readout,
    sleepButton: typeof r.sleepButton === 'boolean' ? r.sleepButton : DEFAULTS.sleepButton,
    volume: pick(r.volume, ['knob', 'bar'] as const, DEFAULTS.volume),
    tuner: typeof r.tuner === 'boolean' ? r.tuner : DEFAULTS.tuner,
    columns,
    songSort: pick(r.songSort, SORTS, DEFAULTS.songSort),
    playlistSort: pick(r.playlistSort, SORTS, DEFAULTS.playlistSort),
    albumSort: pick(r.albumSort, GROUP_SORTS, DEFAULTS.albumSort),
    artistSort: pick(r.artistSort, GROUP_SORTS, DEFAULTS.artistSort),
    shield: typeof r.shield === 'boolean' ? r.shield : DEFAULTS.shield,
    miniPlayer: typeof r.miniPlayer === 'boolean' ? r.miniPlayer : DEFAULTS.miniPlayer,
    tint: typeof r.tint === 'boolean' ? r.tint : DEFAULTS.tint,
    appTint: r.appTint === true,
    immersive: typeof r.immersive === 'boolean' ? r.immersive : DEFAULTS.immersive,
    backdropBlur: num(r.backdropBlur, 0, 80, DEFAULTS.backdropBlur),
    backdropDim: num(r.backdropDim, 0, 80, DEFAULTS.backdropDim),
    backdropMotion: typeof r.backdropMotion === 'boolean' ? r.backdropMotion : DEFAULTS.backdropMotion,
    font: pick(r.font, ['theme', ...FONTS] as const, DEFAULTS.font),
    motion: typeof r.motion === 'boolean' ? r.motion : DEFAULTS.motion,
    sidebarCounts: typeof r.sidebarCounts === 'boolean' ? r.sidebarCounts : DEFAULTS.sidebarCounts,
    listCovers: typeof r.listCovers === 'boolean' ? r.listCovers : DEFAULTS.listCovers,
    clickToPlay: pick(r.clickToPlay, ['single', 'double'] as const, DEFAULTS.clickToPlay),
    startView: pick(r.startView, START_VIEWS, DEFAULTS.startView),
    youtubeControls: typeof r.youtubeControls === 'boolean' ? r.youtubeControls : DEFAULTS.youtubeControls,
    stage: pick(r.stage, ['auto', 'video', 'cover'] as const, DEFAULTS.stage),
    miniSpot: pick(r.miniSpot, SPOTS, DEFAULTS.miniSpot),
    miniPlace: pick(r.miniPlace, ['panel', 'sidebar', 'float'] as const, DEFAULTS.miniPlace),
    miniWidth: typeof r.miniWidth === 'number' && Number.isFinite(r.miniWidth) ? Math.min(960, Math.max(356, Math.round(r.miniWidth))) : DEFAULTS.miniWidth,
    crossfade: typeof r.crossfade === 'number' && Number.isFinite(r.crossfade) ? Math.min(12, Math.max(0, Math.round(r.crossfade))) : DEFAULTS.crossfade,
    skipLong: typeof r.skipLong === 'number' && Number.isFinite(r.skipLong) ? Math.min(60, Math.max(0, Math.round(r.skipLong))) : DEFAULTS.skipLong,
    fade: sanitizeFade(r.fade),
    subtitles: typeof r.subtitles === 'boolean' ? r.subtitles : DEFAULTS.subtitles,
    homeSections: sanitizeHome(r.homeSections),
    smartLists: sanitizeSmart(r.smartLists),
    homeFilter: pick(r.homeFilter, HOME_FILTERS, DEFAULTS.homeFilter),
    playlistOrder: pick(r.playlistOrder, PLAYLIST_ORDERS, DEFAULTS.playlistOrder),
    hiddenPlaylists: Array.isArray(r.hiddenPlaylists) ? [...new Set(r.hiddenPlaylists.filter((k): k is string => typeof k === 'string' && k.length <= 200))].slice(0, 500) : [],
    lyricsSync: sanitizeLyricsSync(r.lyricsSync),
    playlistCovers: sanitizeCovers(r.playlistCovers),
    mixCovers: pick(r.mixCovers, ['grid', 'single', 'template'] as const, DEFAULTS.mixCovers),
    autoUpdate: typeof r.autoUpdate === 'boolean' ? r.autoUpdate : DEFAULTS.autoUpdate,
    upNext: typeof r.upNext === 'boolean' ? r.upNext : DEFAULTS.upNext,
    sidePanel: pick(r.sidePanel, ['upNext', 'lyrics', 'none'] as const, DEFAULTS.sidePanel),
    toastPlace: pick(r.toastPlace, TOAST_PLACES, DEFAULTS.toastPlace),
    toastShow: pick(r.toastShow, ['all', 'important'] as const, DEFAULTS.toastShow),
    toastTime: pick(r.toastTime, ['short', 'normal', 'long'] as const, DEFAULTS.toastTime),
    lyrics: r.lyrics === true,
    editor: r.editor === true,
    resume: typeof r.resume === 'boolean' ? r.resume : DEFAULTS.resume,
    reopen: typeof r.reopen === 'boolean' ? r.reopen : DEFAULTS.reopen,
    closeToTray: typeof r.closeToTray === 'boolean' ? r.closeToTray : DEFAULTS.closeToTray,
    adaptiveSound: r.adaptiveSound === true,
    adaptiveLevel: ADAPTIVE_LEVELS.includes(r.adaptiveLevel as AdaptiveLevel) ? (r.adaptiveLevel as AdaptiveLevel) : DEFAULTS.adaptiveLevel,
    coverPulse: r.coverPulse === true,
    visualizer: r.visualizer === true,
    visualizerStyle: pick(r.visualizerStyle, VISUALIZER_STYLES, 'bars'),
    earlyEnds: r.earlyEnds !== false,
    liveYoutube: typeof r.liveYoutube === 'boolean' ? r.liveYoutube : DEFAULTS.liveYoutube,
    voiceSearch: r.voiceSearch === true,
    autoplay: r.autoplay !== false,
    rememberSearches: r.rememberSearches !== false,
    searchSuggestions: r.searchSuggestions !== false,
    searchOnCover: r.searchOnCover !== false,
    detector: r.detector === true,
    detectorInput: pick(r.detectorInput, ['mic', 'pc'] as const, DEFAULTS.detectorInput),
    detectorPc: r.detectorPc === true,
    shortcuts: sanitizeShortcuts(r.shortcuts),
    addons: Object.fromEntries(Object.entries(r.addons && typeof r.addons === 'object' ? r.addons : {}).filter(([k, v]) => /^[a-z0-9-]{1,40}$/.test(k) && typeof v === 'boolean').slice(0, 100)),
    discord: sanitizeDiscord(r.discord),
    defaultsVersion: DEFAULTS_VERSION,
    // Saved before the defaults changed: take the new ones once.
    ...(saved < 2 ? V2 : {}),
    ...(saved < 3 ? V3 : {}),
    ...(saved < 4 ? V4 : {}),
    ...(saved < 5 ? v5(r) : {}),
    // v7 (app v4, 2026-10-23): a Plays column, for those who kept the old default columns.
    ...(saved < 7 && Array.isArray(r.columns) && r.columns.join() === 'album,sources,duration' ? { columns: COLUMNS.filter((c) => c !== 'added') } : {}),
    // v8 (app v2, 2026-10-29): the theme's sky blue, compact rows without covers, square covers, flat tint.
    ...(saved < 8 ? v8(r) : {}),
    ...(saved < 6 ? { homeSections: sanitizeHome(r.homeSections).map((x) => (HOME_OFF.includes(x.id) ? { ...x, on: false } : x)) } : {}),
  }
}

function sanitizeFade(raw: unknown): FadeSettings {
  const d = DEFAULTS.fade
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  // Half seconds: the curve editor snaps to them.
  const secs = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(12, Math.max(0, Math.round(v * 2) / 2)) : def)
  const curve = (v: unknown, def: FadeCurve) => (FADE_CURVES.includes(v as FadeCurve) ? (v as FadeCurve) : def)
  return {
    advanced: r.advanced === true,
    out: secs(r.out, d.out),
    in: secs(r.in, d.in),
    outCurve: curve(r.outCurve, d.outCurve),
    inCurve: curve(r.inCurve, d.inCurve),
    skip: typeof r.skip === 'boolean' ? r.skip : d.skip,
    pause: typeof r.pause === 'number' && Number.isFinite(r.pause) ? Math.min(2000, Math.max(0, Math.round(r.pause))) : d.pause,
  }
}

function sanitizeDiscord(raw: unknown): DiscordSettings {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const def = DEFAULTS.discord
  return {
    appId: typeof d.appId === 'string' && /^\d{1,32}$/.test(d.appId) ? d.appId : def.appId,
    status: pick(d.status, ['name', 'artist', 'song'] as const, def.status),
    buttons: typeof d.buttons === 'boolean' ? d.buttons : def.buttons,
    paused: typeof d.paused === 'boolean' ? d.paused : def.paused,
    github: typeof d.github === 'boolean' ? d.github : def.github,
  }
}

/** Per-song lyrics fixes: song keys, offset within ±10 min, speed 0.5–2×. */
// shortcut: one settings key for every song, so two PCs fixing different songs at once keep the newest map only; per-song rows if that bites.
function sanitizeLyricsSync(v: unknown): Settings['lyricsSync'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Settings['lyricsSync'] = {}
  for (const [k, f] of Object.entries(v).slice(0, 2000)) {
    const { offset, rate } = (f ?? {}) as { offset?: unknown; rate?: unknown }
    if (k.length > 300 || typeof offset !== 'number' || typeof rate !== 'number' || !Number.isFinite(offset) || !Number.isFinite(rate)) continue
    out[k] = { offset: Math.round(Math.min(600_000, Math.max(-600_000, offset))), rate: Math.min(2, Math.max(0.5, rate)) }
  }
  return out
}

function sanitizeCovers(raw: unknown): Record<string, PlaylistCover> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, PlaylistCover> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
    if (!v || typeof v !== 'object' || k.length > 200) continue
    const c = v as Record<string, unknown>
    const image = typeof c.image === 'string' && /^[\w-]{1,80}\.(png|jpg|webp|gif)$/.test(c.image) ? c.image : undefined
    const mode = pick(c.mode, COVER_MODES, 'source')
    out[k] = { mode: mode === 'image' && !image ? 'source' : mode, order: pick(c.order, COVER_ORDERS, 'playlist'), ...(image && { image }) }
  }
  return out
}

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Pairs checked live in theme editor. AA: 4.5 for text, 3 for icons (accent only carries icons). */
export function contrastReport(t: Palette) {
  return [
    { label: msg('Main text'), ratio: contrast(t.ink, t.bg), min: 4.5 },
    { label: msg('Secondary text'), ratio: contrast(t.ink2, t.bg), min: 4.5 },
    { label: msg('Muted text'), ratio: contrast(t.ink3, t.bg), min: 4.5 },
    { label: msg('Text on panel'), ratio: contrast(t.ink2, t.panel), min: 4.5 },
    { label: msg('Muted text on cards'), ratio: Math.min(contrast(t.ink3, t.panel), contrast(t.ink3, t.raised)), min: 4.5 },
    { label: msg('Icon on accent'), ratio: contrast(t.onAccent, t.accent), min: 3 },
  ].map((c) => ({ ...c, ok: c.ratio >= c.min }))
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
/** a → b by t (0..1), in sRGB. */
export const mix = (a: string, b: string, t: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t))

/** Moves `c` toward `toward` until it reaches `min` contrast on every one of `on`. */
function readable(c: string, toward: string, on: string[], min: number): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const x = mix(c, toward, t)
    if (on.every((b) => contrast(x, b) >= min)) return x
  }
  return toward
}

/** A whole palette from one color: neutrals lightly tinted with it, text checked for AA contrast. */
export function paletteFrom(accent: string, dark: boolean): Palette {
  const bg = mix(dark ? '#111111' : '#F6F6F4', accent, dark ? 0.07 : 0.05)
  const ink = mix(dark ? '#F2F2F2' : '#151515', accent, 0.04)
  const panel = mix(bg, ink, dark ? 0.05 : 0.035)
  const raised = dark ? mix(bg, ink, 0.1) : mix(bg, '#FFFFFF', 0.65)
  return {
    bg,
    panel,
    raised,
    recess: dark ? mix(bg, '#000000', 0.45) : mix(bg, ink, 0.07),
    line: mix(bg, ink, 0.17),
    lineSoft: mix(bg, ink, 0.1),
    ink,
    ink2: readable(mix(ink, bg, 0.4), ink, [bg, panel], 4.5),
    ink3: readable(mix(ink, bg, 0.5), ink, [bg, panel, raised], 4.5),
    ink4: mix(ink, bg, 0.7),
    accent: accent.toUpperCase(),
    onAccent: onAccentFor(accent),
    ledOff: mix(bg, ink, 0.22),
  }
}

/** Text / icon color on an accent: first of white, ink, black reaching AA 4.5 (black always does). */
export const onAccentFor = (accent: string) => ['#FFFFFF', '#171614'].find((c) => contrast(c, accent) >= 4.5) ?? '#000000'

/** src-tauri system_accent: Windows accent tuned per theme brightness. */
export interface SystemAccent {
  light: string
  dark: string
}

export function resolveTheme(s: Settings, systemDark: boolean, system: SystemAccent | null = null): Theme {
  const id = s.theme === 'system' ? (systemDark ? 'modern-dark' : 'modern') : s.theme
  const t = [...PRESETS, ...s.customThemes].find((x) => x.id === id) ?? PRESETS[0]
  const sys = system && [system.light, system.dark].every(isHex) ? (t.dark ? system.dark : system.light).toUpperCase() : null
  const accent = s.accent === 'system' ? sys : s.accent
  return accent ? { ...t, accent, onAccent: onAccentFor(accent) } : t
}

const FONT_STACKS: Record<Font, string> = {
  modern: "'Roboto Variable', Roboto, 'Segoe UI', system-ui, sans-serif",
  hifi: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, sans-serif",
  neutral: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
}

const kebab = (k: string) => k.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)

/** Tailwind's radius scale per theme roundness (soft = Tailwind's own). */
const RADIUS_SCALE: Record<Radius, [string, string, string, string, string]> = {
  sharp: ['1px', '2px', '3px', '4px', '6px'],
  soft: ['4px', '6px', '8px', '12px', '16px'],
  round: ['8px', '12px', '16px', '20px', '28px'],
}

/** Theme + layout settings → CSS custom properties (consumed by styles.css). */
export function cssVars(t: Theme, s: Settings): Record<string, string> {
  const r = RADIUS_SCALE[t.radius ?? 'soft']
  // A picture behind: main surfaces see-through over it.
  const see = (k: 'bg' | 'panel' | 'raised', extra = 0) => (t.background ? `color-mix(in srgb, ${t[k]} ${Math.min(100, t.background.panels + extra)}%, transparent)` : t[k])
  return {
    ...Object.fromEntries(PALETTE_KEYS.map((k) => [`--${kebab(k)}`, t[k]])),
    '--bg': see('bg'),
    '--panel': see('panel'),
    '--raised': see('raised', 10),
    '--bg-solid': t.bg,
    '--body-bg': t.background ? 'transparent' : t.bg,
    '--theme-size': { cover: 'cover', contain: 'contain', tile: 'auto' }[t.background?.fit ?? 'cover'],
    '--theme-repeat': t.background?.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--theme-blur': `${t.background?.blur ?? 0}px`,
    '--theme-dim': t.background ? `color-mix(in srgb, ${t.bg} ${t.background.dim}%, transparent)` : 'transparent',
    '--radius-sm': r[0],
    '--radius-md': r[1],
    '--radius-lg': r[2],
    '--radius-xl': r[3],
    '--radius-2xl': r[4],
    '--accent-soft': `${t.accent}1F`,
    // Accent as text: darkened toward ink until AA (sky blue on white is 2:1).
    '--accent-ink': readable(t.accent, t.ink, [t.bg, t.panel], 4.5),
    '--shadow': t.dark ? '#00000099' : '#17161424',
    '--led-glow': t.glow ? `0 0 6px ${t.accent}AA` : 'none',
    '--font-ui': FONT_STACKS[s.font === 'theme' ? t.font : s.font],
    '--cover-radius': { net: '4px', rounded: '10px', vinyl: '999px' }[s.covers],
    '--row-h': { compact: '40px', comfort: '52px', airy: '64px' }[s.density],
    '--text-scale': String(TEXT_SCALES[s.textSize]),
    'color-scheme': t.dark ? 'dark' : 'light',
  }
}
