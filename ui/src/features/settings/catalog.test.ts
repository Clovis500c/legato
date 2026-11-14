import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryOf, groupDef, GROUPS, labelOf, missingLabels, SETTINGS } from './catalog'
import { DESKTOP_ONLY } from './desktopOnly'
import { PHONE_FOLDED } from './phoneFold'
import { searchSettings, type SettingEntry } from './search'

/** Every setting the search knew before the reorganisation (2026-11-13), by its English label: none may be lost. */
const BEFORE = [
  'Language', 'Theme', 'Accent color', 'Font', 'Covers', 'List density', 'Text size', 'Interface size', 'Hi-Fi extras', 'Source icon', 'Volume control', 'Sleep timer button',
  'Skip long songs', 'Scan QR codes with the webcam', 'Equalizer per output device', 'Cast to speakers', 'Translate lyrics', 'Chapters of long YouTube videos', 'Estimate tempo',
  'Volume per source', 'Volume per output device', 'Focus and workout sessions', 'Last.fm suggestions', 'Blind test', 'Podcasts', 'Fade between songs', 'Sweet fades', 'Early endings',
  'Skip silence', 'Skip non-music parts', 'Tuner scale', 'Glow', 'Immersive player', 'Cover tint', 'Mini player', 'Mini player place', 'Progress bar', 'Covers in lists',
  'Clock on the cover display', 'Column browser', 'Covers for new releases', 'Hide explicit songs', 'Whole app in the cover’s color', 'Play with', 'Sidebar entries',
  'Counts in the sidebar', 'Open on', 'Update channel', 'Cover cache size', 'Back up your library', 'Restore a backup', 'Clear covers', 'Your library', 'Lyrics and song analyses',
  'Diagnostics log', 'Animations', 'List columns', 'YouTube Music', 'Update every 15 minutes', 'Sync direction', 'Spotify', 'OneDrive', 'Your devices', 'Spotify web player',
  'Apple Music', 'Local files', 'Your music server', 'Block ads and trackers', 'The app', 'App windows', 'Automatic updates', 'App status', 'About', 'Third-party licenses',
  'Copy diagnostics', 'Smart shuffle', 'Songs heard lately', 'Your ratings count', 'Alarm', 'Same artist again', 'Pause during calls', 'Keep the screen on', 'Phone remote',
  'Streaming overlay', 'Visualizer on the overlay', 'Pause when headphones disconnect', 'No fade within an album', 'Advanced fade', 'Fade in after a skip', 'Fade on pause and play',
  'Sound processing', 'Adaptive Sound', 'Adaptive Sound level', 'Volume levelling', 'Moving cover', 'Visualizer', 'Visualizer style', 'Meter face', 'Spectrogram colors',
  'Visualizer preset', 'Preset colors', 'Visualizer weighting', 'Visualizer color', 'Visualizer gradient', 'Visualizer bands', 'Visualizer reflection',
  'Visualizer behind Now Playing', 'Visualizer in the mini player', "Process YouTube's sound", 'Background blur', 'Background dimming', 'Background motion',
  'Flowing background behind Home', 'Flowing background', 'Mix covers', 'Open at startup', 'Keep running in the notification area', 'Picture-in-picture on minimize',
  'Classic mini player', 'Reopen where you left off', 'Living-room mode', 'Audiobooks', 'TV home', 'Check podcasts', 'Discord sign-in', 'Resume playback on launch',
  'Notification position', 'Which notifications', 'How long notifications stay', 'Remember recent searches', 'Search suggestions', 'Voice search', 'Music Detector',
  'Ask this PC’s media players first', 'Name songs with AcoustID (free)', 'Subtitles on videos', 'YouTube controls on the video', 'Right-click menus',
]

const view = readFileSync(new URL('./SettingsView.tsx', import.meta.url), 'utf8')
const titles = [...view.matchAll(/<Group (?:key=\{[^}]*\} )?title=\{msg\((['"])(.*?)\1\)/g)].map((m) => m[2])
const rows = [...view.matchAll(/<Row (?:setting="\w+" )?label=\{msg\((['"])(.*?)\1\)/g)].map((m) => m[2])

describe('settings catalog', () => {
  it('every setting the search knew still has a page and is still found by its name', () => {
    for (const id of BEFORE) {
      expect(categoryOf(id), id).toBeDefined()
      expect(searchSettings(id).map((e) => e.label), id).toContain(id)
    }
  })

  it('every group drawn has its place in the table, and every place is a page', () => {
    expect(titles.length).toBeGreaterThan(30)
    for (const t of titles) expect(groupDef(t), t).toBeDefined()
    const pages = new Set(CATEGORIES.map((c) => c.id))
    for (const g of GROUPS) expect(pages.has(g.category), g.id).toBe(true)
    for (const s of SETTINGS) expect(categoryOf(s.id), s.id).toBeDefined()
  })

  it('one place per setting: ids are unique, and every row drawn is in one group only', () => {
    expect(new Set(GROUPS.map((g) => g.id)).size).toBe(GROUPS.length)
    expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length)
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('a setting moved to another group is still found by the old group’s name', () => {
    for (const s of SETTINGS.filter((e) => e.was)) expect(searchSettings(`${s.was} ${s.id}`).map((e) => e.label), s.id).toContain(s.id)
    expect(searchSettings('up next webcam').map((e) => e.label)).toContain('Scan QR codes with the webcam')
  })

  it('the phone’s lists name settings or groups the table knows', () => {
    for (const id of [...DESKTOP_ONLY, ...PHONE_FOLDED]) expect(categoryOf(id) ?? groupDef(id)?.category, id).toBeDefined()
  })

  it('every setting and group shows a label (its id by default), and a relabelled one is still found by its old name', () => {
    for (const e of [...GROUPS, ...SETTINGS]) expect(labelOf(e.id).trim(), e.id).not.toBe('')
    expect(labelOf('Sleep timer button')).toBe('Sleep timer button')
    for (const e of [...GROUPS, ...SETTINGS].filter((d) => d.label)) expect(searchSettings(e.id).map((h) => h.label), e.id).toContain(e.id)
    const moved: SettingEntry = { section: 'playback', label: 'Old name', name: 'Short' }
    expect(searchSettings('old name', [moved])).toEqual([moved])
    expect(searchSettings('short', [moved])).toEqual([moved])
  })

  it('a label must be in every language unless it is marked to translate', () => {
    const defs = [
      { id: 'A', in: 'Fades', label: 'Done' },
      { id: 'B', in: 'Fades', label: 'Later', toTranslate: true as const },
      { id: 'C', in: 'Fades', label: 'Forgot' },
    ]
    expect(missingLabels({ Done: 'Fait' }, defs)).toEqual(['Forgot'])
  })
})
