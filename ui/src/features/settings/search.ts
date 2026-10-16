import type { SettingsSection } from '../../app/store'
import { SHORTCUTS } from '../../app/shortcuts'

/** One searchable setting. label = Row / Group title on screen (data-setting), found and highlighted on open. */
export interface SettingEntry {
  section: SettingsSection
  label: string
  keywords?: string
}

export const SETTINGS_INDEX: SettingEntry[] = [
  { section: 'appearance', label: 'Theme', keywords: 'dark light mode windows color' },
  { section: 'appearance', label: 'Accent color', keywords: 'colour highlight windows' },
  { section: 'appearance', label: 'Font', keywords: 'typeface roboto text' },
  { section: 'appearance', label: 'Covers', keywords: 'cover shape round vinyl sharp artwork' },
  { section: 'appearance', label: 'List density', keywords: 'compact rows spacing' },
  { section: 'appearance', label: 'Interface size', keywords: 'zoom scale bigger smaller' },
  { section: 'appearance', label: 'Readout', keywords: 'source format display' },
  { section: 'appearance', label: 'Volume control', keywords: 'knob bar slider sound' },
  { section: 'appearance', label: 'Fade between songs', keywords: 'crossfade transition fade out in' },
  { section: 'appearance', label: 'Tuner scale', keywords: 'progress bar seek' },
  { section: 'appearance', label: 'Immersive player', keywords: 'blur blurred background cover now playing ambient' },
  { section: 'appearance', label: 'Cover tint', keywords: 'ambient background color now playing' },
  { section: 'appearance', label: 'Mini player', keywords: 'floating card video' },
  { section: 'appearance', label: 'Covers in lists', keywords: 'thumbnails artwork rows' },
  { section: 'appearance', label: 'Play with', keywords: 'single double click row' },
  { section: 'appearance', label: 'Counts in the sidebar', keywords: 'numbers songs' },
  { section: 'appearance', label: 'Open on', keywords: 'start screen launch home' },
  { section: 'appearance', label: 'Animations', keywords: 'motion transitions reduce' },
  { section: 'appearance', label: 'List columns', keywords: 'album sources duration' },
  { section: 'themes', label: 'Themes', keywords: 'editor custom colors import export palette contrast' },
  { section: 'sources', label: 'YouTube Music', keywords: 'google sign in account import playlists sync liked' },
  { section: 'sources', label: 'Spotify', keywords: 'client id key premium connect' },
  { section: 'sources', label: 'Spotify web player', keywords: 'sign in' },
  { section: 'sources', label: 'Local files', keywords: 'music folder mp3 flac scan' },
  { section: 'shield', label: 'Block ads and trackers', keywords: 'adblock shield easylist privacy' },
  ...SHORTCUTS.map((s): SettingEntry => ({ section: 'shortcuts', label: s.label, keywords: `keyboard shortcut ${s.keys}` })),
  { section: 'advanced', label: 'Resume playback on launch', keywords: 'restore continue reopen last track start' },
  { section: 'advanced', label: 'Subtitles on videos', keywords: 'captions cc closed' },
  { section: 'advanced', label: 'YouTube controls on the video', keywords: 'overlay title buttons hover embed' },
]

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Entries where every word typed appears in the label or keywords; label matches first. */
export function searchSettings(query: string, index = SETTINGS_INDEX): SettingEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits = index.filter((e) => {
    const text = fold(`${e.label} ${e.keywords ?? ''}`)
    return words.every((w) => text.includes(w))
  })
  const inLabel = (e: SettingEntry) => words.every((w) => fold(e.label).includes(w))
  return [...hits.filter(inLabel), ...hits.filter((e) => !inLabel(e))]
}
