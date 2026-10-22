/** Hi-Fi themes: palettes, user settings schema, contrast check. Applied as CSS variables (styles.css @theme). */
import { LANGUAGES, msg, tr } from '../i18n/i18n'
import { ACTIONS, validCombo, type Custom } from '../../app/keys'
import { cleanCss } from '../css'

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
export const LOOK_KEYS = ['covers', 'density', 'readout', 'volume', 'tuner', 'tint', 'immersive', 'backdropBlur', 'backdropDim', 'backdropMotion', 'motion', 'sidebarCounts', 'listCovers', 'columns'] as const
export type LookKey = (typeof LOOK_KEYS)[number]
export type Look = Partial<Pick<Settings, LookKey>>

/** Theme CSS kept in settings (synced, size-bounded): 20 KB. */
export const MAX_THEME_CSS = 20_000

/** modern = Roboto (YouTube's UI font), hifi = Schibsted Grotesk, neutral = Segoe UI. */
export const FONTS = ['modern', 'hifi', 'neutral'] as const
export type Font = (typeof FONTS)[number]

const preset = (id: string, name: string, dark: boolean, p: Palette, font: Font = 'hifi', glow = true): Theme => ({ id, name, dark, font, glow, radius: 'soft', ...p })

// ink3 values tuned for WCAG AA (4.5:1) on bg.
export const PRESETS: Theme[] = [
  // YouTube's own palettes and font: what System follows by default.
  preset('modern', 'Modern', false, { bg: '#FFFFFF', panel: '#F9F9F9', raised: '#F2F2F2', recess: '#F2F2F2', line: '#E5E5E5', lineSoft: '#EFEFEF', ink: '#0F0F0F', ink2: '#606060', ink3: '#606060', ink4: '#CCCCCC', accent: '#FF0033', onAccent: '#FFFFFF', ledOff: '#D9D9D9' }, 'modern', false),
  preset('modern-dark', 'Modern Dark', true, { bg: '#0F0F0F', panel: '#181818', raised: '#272727', recess: '#090909', line: '#3F3F3F', lineSoft: '#272727', ink: '#F1F1F1', ink2: '#AAAAAA', ink3: '#909090', ink4: '#4D4D4D', accent: '#FF0033', onAccent: '#FFFFFF', ledOff: '#3F3F3F' }, 'modern', false),
  preset('paper', 'Paper', false, { bg: '#F3F1EC', panel: '#EAE7E0', raised: '#FBFAF7', recess: '#E1DDD4', line: '#D6D1C6', lineSoft: '#E4E0D7', ink: '#171614', ink2: '#5C5852', ink3: '#6B665E', ink4: '#B2ACA1', accent: '#FF5A1F', onAccent: '#FFFFFF', ledOff: '#CDC7BB' }),
  preset('graphite', 'Graphite', true, { bg: '#121211', panel: '#1A1A18', raised: '#24231F', recess: '#0B0B0A', line: '#302F2B', lineSoft: '#252421', ink: '#EDEAE4', ink2: '#A6A198', ink3: '#8A847B', ink4: '#55524C', accent: '#FF6A2E', onAccent: '#171614', ledOff: '#3A3935' }),
  preset('studio', 'Studio', true, { bg: '#000000', panel: '#0A0A0A', raised: '#161616', recess: '#000000', line: '#262626', lineSoft: '#1A1A1A', ink: '#FFFFFF', ink2: '#A3A3A3', ink3: '#7A7A7A', ink4: '#4D4D4D', accent: '#FF3B30', onAccent: '#FFFFFF', ledOff: '#333333' }),
  preset('aluminum', 'Aluminum', false, { bg: '#ECEEF0', panel: '#E1E4E8', raised: '#F7F8F9', recess: '#D7DBE0', line: '#C9CED5', lineSoft: '#DADEE3', ink: '#14171A', ink2: '#4E5660', ink3: '#5D656F', ink4: '#A4ACB5', accent: '#2F6FEB', onAccent: '#FFFFFF', ledOff: '#BFC5CC' }),
  preset('bakelite', 'Bakelite', true, { bg: '#1C1410', panel: '#241A14', raised: '#2E221A', recess: '#140E0B', line: '#3D2E24', lineSoft: '#2E231B', ink: '#F2E6D3', ink2: '#BFAE95', ink3: '#9E8E77', ink4: '#5E5244', accent: '#F2A900', onAccent: '#1C1410', ledOff: '#4A3B2F' }),
  preset('sage', 'Sage', false, { bg: '#E7ECE6', panel: '#DCE3DA', raised: '#F4F7F3', recess: '#D1D9CF', line: '#C2CCBF', lineSoft: '#D5DDD2', ink: '#152019', ink2: '#4C5B50', ink3: '#5B6A5E', ink4: '#A0ADA2', accent: '#1F7A4D', onAccent: '#FFFFFF', ledOff: '#B8C3B6' }),
]

export const ACCENTS = ['#FF5A1F', '#E5383B', '#F2B705', '#2E8B57', '#2F6FEB', '#171614']

export const COLUMNS = ['album', 'sources', 'duration'] as const
export type Column = (typeof COLUMNS)[number]

export const START_VIEWS = ['home', 'songs', 'mixes', 'albums', 'artists'] as const

/** Mini player resting spots: corners and edge middles (t = top, b = bottom, l = left, r = right). */
/** Playlist icon: service logo, first song's cover, grid of the first 4, or a picked image. */
export const COVER_MODES = ['source', 'first', 'grid', 'image'] as const
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
const DEFAULTS_VERSION = 5

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
  /** Hex overrides theme accent; 'system' = Windows accent; null = theme's own. */
  accent: string | null
  customThemes: Theme[]
  covers: 'net' | 'rounded' | 'vinyl'
  density: 'compact' | 'comfort' | 'airy'
  /** Text only (rem sizes), apart from the interface zoom. */
  textSize: TextSize
  /** Webview zoom, percent. */
  zoom: number
  readout: boolean
  volume: 'knob' | 'bar'
  tuner: boolean
  columns: Column[]
  /** Ad/tracker blocker (read by Rust at launch). */
  shield: boolean
  /** Floating mini player for every source (YouTube always shows one: its video must stay visible). */
  miniPlayer: boolean
  /** Now Playing takes a flat tint from the cover. */
  tint: boolean
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
  /** Where the mini player sits: docked at the bottom of the sidebar (never over the content) or floating. */
  miniPlace: 'sidebar' | 'float'
  /** Mini player width, px (video 16:9 below it, 200 px tall at least). */
  miniWidth: number
  /** Fade between songs, seconds (0 = off). */
  crossfade: number
  fade: FadeSettings
  /** YouTube subtitles (off: hidden even when the Google account turns them on). */
  subtitles: boolean
  /** Playlists left out of the sidebar and menus (playlistKey), still in the library. */
  hiddenPlaylists: string[]
  /** Per playlist (playlistKey). Missing = service logo in the sidebar, first cover on its page. */
  playlistCovers: Record<string, PlaylistCover>
  /** Mixes page: 4 song covers, the first one, or the plain numbered tile. */
  mixCovers: 'grid' | 'single' | 'template'
  /** Download updates in the background and install them when nothing plays. */
  autoUpdate: boolean
  /** Now Playing: Up next panel open. */
  upNext: boolean
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
  /** YouTube's sound may go through the processing above (off: untouched, features work on local files only). */
  liveYoutube: boolean
  /** Voice search agreed to (Windows' online speech recognition: the voice goes to Microsoft while the mic listens). */
  voiceSearch: boolean
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
  accent: 'system',
  customThemes: [],
  covers: 'rounded',
  density: 'comfort',
  textSize: 'normal',
  zoom: 100,
  readout: true,
  volume: 'bar',
  tuner: false,
  columns: [...COLUMNS],
  shield: true,
  miniPlayer: false,
  tint: true,
  immersive: true,
  backdropBlur: 24,
  backdropDim: 40,
  backdropMotion: true,
  font: 'theme',
  motion: true,
  sidebarCounts: true,
  listCovers: true,
  clickToPlay: 'single',
  startView: 'home',
  youtubeControls: false,
  stage: 'auto',
  miniSpot: 'br',
  miniPlace: 'sidebar',
  miniWidth: 356,
  crossfade: 2,
  fade: { advanced: false, out: 2, in: 2, outCurve: 'scurve', inCurve: 'scurve', skip: false, pause: 0 },
  subtitles: false,
  hiddenPlaylists: [],
  playlistCovers: {},
  mixCovers: 'grid',
  autoUpdate: true,
  upNext: true,
  lyrics: false,
  editor: false,
  resume: true,
  reopen: true,
  closeToTray: true,
  adaptiveSound: false,
  adaptiveLevel: -14,
  coverPulse: false,
  liveYoutube: true,
  voiceSearch: false,
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

/** Version 5 (user's picks 2026-10-22): mini player in the sidebar, bigger text; 2 s fades instead of 5 for those who
 * never changed them. */
function v5(r: Record<string, unknown>): Partial<Settings> {
  const f = (r.fade ?? {}) as Record<string, unknown>
  const untouched = (r.crossfade ?? 5) === 5 && (f.out ?? 5) === 5 && (f.in ?? 5) === 5 && f.advanced !== true
  return { miniPlace: 'sidebar', textSize: 'normal', ...(untouched && { crossfade: 2, fade: { ...sanitizeFade(r.fade), out: 2, in: 2 } }) }
}

const HEX = /^#[0-9a-f]{6}$/i
/** Background file names as `save_background` writes them. */
const BG_NAME = /^bg-[0-9a-f]{16}\.(png|jpg|webp|gif)$/
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
    accent: isHex(r.accent) ? r.accent.toUpperCase() : r.accent === null ? null : DEFAULTS.accent,
    customThemes,
    covers: pick(r.covers, ['net', 'rounded', 'vinyl'] as const, DEFAULTS.covers),
    density: pick(r.density, ['compact', 'comfort', 'airy'] as const, DEFAULTS.density),
    textSize: pick(r.textSize, Object.keys(TEXT_SCALES) as TextSize[], DEFAULTS.textSize),
    zoom: typeof r.zoom === 'number' && Number.isFinite(r.zoom) ? Math.min(125, Math.max(90, Math.round(r.zoom / 5) * 5)) : DEFAULTS.zoom,
    readout: typeof r.readout === 'boolean' ? r.readout : DEFAULTS.readout,
    volume: pick(r.volume, ['knob', 'bar'] as const, DEFAULTS.volume),
    tuner: typeof r.tuner === 'boolean' ? r.tuner : DEFAULTS.tuner,
    columns,
    shield: typeof r.shield === 'boolean' ? r.shield : DEFAULTS.shield,
    miniPlayer: typeof r.miniPlayer === 'boolean' ? r.miniPlayer : DEFAULTS.miniPlayer,
    tint: typeof r.tint === 'boolean' ? r.tint : DEFAULTS.tint,
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
    miniPlace: pick(r.miniPlace, ['sidebar', 'float'] as const, DEFAULTS.miniPlace),
    miniWidth: typeof r.miniWidth === 'number' && Number.isFinite(r.miniWidth) ? Math.min(960, Math.max(356, Math.round(r.miniWidth))) : DEFAULTS.miniWidth,
    crossfade: typeof r.crossfade === 'number' && Number.isFinite(r.crossfade) ? Math.min(12, Math.max(0, Math.round(r.crossfade))) : DEFAULTS.crossfade,
    fade: sanitizeFade(r.fade),
    subtitles: typeof r.subtitles === 'boolean' ? r.subtitles : DEFAULTS.subtitles,
    hiddenPlaylists: Array.isArray(r.hiddenPlaylists) ? [...new Set(r.hiddenPlaylists.filter((k): k is string => typeof k === 'string' && k.length <= 200))].slice(0, 500) : [],
    playlistCovers: sanitizeCovers(r.playlistCovers),
    mixCovers: pick(r.mixCovers, ['grid', 'single', 'template'] as const, DEFAULTS.mixCovers),
    autoUpdate: typeof r.autoUpdate === 'boolean' ? r.autoUpdate : DEFAULTS.autoUpdate,
    upNext: typeof r.upNext === 'boolean' ? r.upNext : DEFAULTS.upNext,
    lyrics: r.lyrics === true,
    editor: r.editor === true,
    resume: typeof r.resume === 'boolean' ? r.resume : DEFAULTS.resume,
    reopen: typeof r.reopen === 'boolean' ? r.reopen : DEFAULTS.reopen,
    closeToTray: typeof r.closeToTray === 'boolean' ? r.closeToTray : DEFAULTS.closeToTray,
    adaptiveSound: r.adaptiveSound === true,
    adaptiveLevel: ADAPTIVE_LEVELS.includes(r.adaptiveLevel as AdaptiveLevel) ? (r.adaptiveLevel as AdaptiveLevel) : DEFAULTS.adaptiveLevel,
    coverPulse: r.coverPulse === true,
    liveYoutube: typeof r.liveYoutube === 'boolean' ? r.liveYoutube : DEFAULTS.liveYoutube,
    voiceSearch: r.voiceSearch === true,
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
    skip: r.skip === true,
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
  return {
    bg,
    panel,
    raised: dark ? mix(bg, ink, 0.1) : mix(bg, '#FFFFFF', 0.65),
    recess: dark ? mix(bg, '#000000', 0.45) : mix(bg, ink, 0.07),
    line: mix(bg, ink, 0.17),
    lineSoft: mix(bg, ink, 0.1),
    ink,
    ink2: readable(mix(ink, bg, 0.4), ink, [bg, panel], 4.5),
    ink3: readable(mix(ink, bg, 0.5), ink, [bg, panel], 4.5),
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
    '--shadow': t.dark ? '#00000099' : '#17161424',
    '--led-glow': t.glow ? `0 0 6px ${t.accent}AA` : 'none',
    '--font-ui': FONT_STACKS[s.font === 'theme' ? t.font : s.font],
    '--cover-radius': { net: '3px', rounded: '10px', vinyl: '999px' }[s.covers],
    '--row-h': { compact: '40px', comfort: '52px', airy: '64px' }[s.density],
    '--text-scale': String(TEXT_SCALES[s.textSize]),
    'color-scheme': t.dark ? 'dark' : 'light',
  }
}
