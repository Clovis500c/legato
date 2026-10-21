import type { SettingsSection } from '../../app/store'
import { ACTIONS, comboLabel } from '../../app/keys'
import { msg, tr } from '../../shared/i18n/i18n'

/**
 * One searchable setting. label = Row / Group title on screen in English (its data-setting id), found and highlighted
 * on open. Label and keywords are matched in English and in the interface's language.
 */
export interface SettingEntry {
  section: SettingsSection
  label: string
  keywords?: string
  /** Matched as is (key names). */
  extra?: string
}

export const SETTINGS_INDEX: SettingEntry[] = [
  { section: 'appearance', label: msg('Language'), keywords: msg('language translation translate english french interface') },
  { section: 'appearance', label: msg('Theme'), keywords: msg('dark light mode windows color themes editor custom colors import export palette contrast picture background image wallpaper corners css') },
  { section: 'appearance', label: msg('Accent color'), keywords: msg('colour highlight windows') },
  { section: 'appearance', label: msg('Font'), keywords: msg('typeface roboto text') },
  { section: 'appearance', label: msg('Covers'), keywords: msg('cover shape round vinyl sharp artwork') },
  { section: 'appearance', label: msg('List density'), keywords: msg('compact rows spacing') },
  { section: 'appearance', label: msg('Interface size'), keywords: msg('zoom scale bigger smaller') },
  { section: 'appearance', label: msg('Source icon'), keywords: msg('readout source format youtube local display') },
  { section: 'appearance', label: msg('Volume control'), keywords: msg('knob bar slider sound') },
  { section: 'appearance', label: msg('Fade between songs'), keywords: msg('crossfade transition fade out in') },
  { section: 'appearance', label: msg('Tuner scale'), keywords: msg('progress bar seek') },
  { section: 'appearance', label: msg('Immersive player'), keywords: msg('blur blurred background cover now playing ambient') },
  { section: 'appearance', label: msg('Cover tint'), keywords: msg('ambient background color now playing') },
  { section: 'appearance', label: msg('Mini player'), keywords: msg('floating card video') },
  { section: 'appearance', label: msg('Covers in lists'), keywords: msg('thumbnails artwork rows') },
  { section: 'appearance', label: msg('Play with'), keywords: msg('single double click row') },
  { section: 'appearance', label: msg('Counts in the sidebar'), keywords: msg('numbers songs') },
  { section: 'appearance', label: msg('Open on'), keywords: msg('start screen launch home') },
  { section: 'appearance', label: msg('Animations'), keywords: msg('motion transitions reduce') },
  { section: 'appearance', label: msg('List columns'), keywords: msg('album sources duration') },
  { section: 'sources', label: 'YouTube Music', keywords: msg('google sign in account import playlists sync liked') },
  { section: 'sources', label: 'Spotify', keywords: msg('client id key premium connect') },
  { section: 'sync', label: 'OneDrive', keywords: msg('sync other pc computer cloud password encrypted backup') },
  { section: 'sync', label: msg('Sync over the network'), keywords: msg('code local wifi other pc computer') },
  { section: 'sources', label: msg('Spotify web player'), keywords: msg('sign in') },
  { section: 'sources', label: msg('Local files'), keywords: msg('music folder mp3 flac scan') },
  { section: 'shield', label: msg('Block ads and trackers'), keywords: msg('adblock shield easylist privacy') },
  ...ACTIONS.map((a): SettingEntry => ({ section: 'shortcuts', label: a.label, keywords: msg('keyboard shortcut hotkey global background'), extra: a.keys ? comboLabel(a.keys) : undefined })),
  { section: 'about', label: msg('Automatic updates'), keywords: msg('update version upgrade install new release') },
  { section: 'about', label: msg('App status'), keywords: msg('stats cache memory songs playlists listens') },
  { section: 'about', label: msg('About'), keywords: msg('version license github source privacy') },
  { section: 'about', label: msg('Third-party licenses'), keywords: msg('open source credits notices attribution copyright mit apache mpl fonts') },
  { section: 'advanced', label: msg('Advanced fade'), keywords: msg('fade curve crossfade graph volume shape equal power exponential logarithmic s-curve dj') },
  { section: 'advanced', label: msg('Fade in after a skip'), keywords: msg('fade manual next pick') },
  { section: 'advanced', label: msg('Fade on pause and play'), keywords: msg('fade pause unpause smooth glide') },
  { section: 'advanced', label: msg('Sound processing'), keywords: msg('audio live effects dsp') },
  { section: 'advanced', label: msg('Adaptive Sound'), keywords: msg('loudness normalize normalization volume level even agc auto gain lufs') },
  { section: 'advanced', label: msg('Adaptive Sound level'), keywords: msg('loudness target quiet normal loud lufs') },
  { section: 'advanced', label: msg('Moving cover'), keywords: msg('animation pulse beat visualizer artwork react music') },
  { section: 'advanced', label: msg("Process YouTube's sound"), keywords: msg('audio live youtube video processing') },
  { section: 'advanced', label: msg('Background blur'), keywords: msg('immersive blurry flou sharp') },
  { section: 'advanced', label: msg('Background dimming'), keywords: msg('immersive dark veil brightness') },
  { section: 'advanced', label: msg('Background motion'), keywords: msg('immersive animation drift') },
  { section: 'advanced', label: msg('Mix covers'), keywords: msg('mixes artwork grid daily template image') },
  { section: 'advanced', label: msg('Open at startup'), keywords: msg('launch boot login sign in windows task manager autostart start automatically') },
  { section: 'advanced', label: msg('Keep running in the notification area'), keywords: msg('tray background close minimize system tray quit discord') },
  { section: 'advanced', label: msg('Reopen where you left off'), keywords: msg('restore state screen last session launch') },
  { section: 'advanced', label: msg('Resume playback on launch'), keywords: msg('restore continue reopen last track start') },
  { section: 'advanced', label: msg('Voice search'), keywords: msg('mic microphone speech speak dictation privacy') },
  { section: 'advanced', label: msg('Music Detector'), keywords: msg('identify recognize song shazam microphone audd listen what song') },
  { section: 'advanced', label: msg('Subtitles on videos'), keywords: msg('captions cc closed') },
  { section: 'advanced', label: msg('YouTube controls on the video'), keywords: msg('overlay title buttons hover embed') },
]

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Entries where every word typed appears in the label or keywords (English or the interface's language); label matches first. */
export function searchSettings(query: string, index = SETTINGS_INDEX): SettingEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const label = (e: SettingEntry) => fold(`${e.label} ${tr(e.label)}`)
  const hits = index.filter((e) => {
    const text = `${label(e)} ${fold(`${e.keywords ?? ''} ${e.keywords ? tr(e.keywords) : ''} ${e.extra ?? ''}`)}`
    return words.every((w) => text.includes(w))
  })
  const inLabel = (e: SettingEntry) => words.every((w) => label(e).includes(w))
  return [...hits.filter(inLabel), ...hits.filter((e) => !inLabel(e))]
}
