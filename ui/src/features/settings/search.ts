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
  { section: 'general', label: msg('Language'), keywords: msg('language translation translate english french interface') },
  { section: 'appearance', label: msg('Theme'), keywords: msg('dark light mode windows color themes editor custom colors import export palette contrast picture background image wallpaper corners css') },
  { section: 'appearance', label: msg('Accent color'), keywords: msg('colour highlight windows') },
  { section: 'appearance', label: msg('Font'), keywords: msg('typeface roboto text') },
  { section: 'appearance', label: msg('Covers'), keywords: msg('cover shape round vinyl sharp artwork') },
  { section: 'appearance', label: msg('List density'), keywords: msg('compact rows spacing') },
  { section: 'appearance', label: msg('Text size'), keywords: msg('font bigger smaller readable letters') },
  { section: 'appearance', label: msg('Interface size'), keywords: msg('zoom scale bigger smaller') },
  { section: 'appearance', label: msg('Hi-Fi extras'), keywords: msg('hifi extras player details touches') },
  { section: 'appearance', label: msg('Source icon'), keywords: msg('readout source format youtube local display') },
  { section: 'appearance', label: msg('Volume control'), keywords: msg('knob bar slider sound') },
  { section: 'appearance', label: msg('Sleep timer button'), keywords: msg('moon sleep timer button hide') },
  { section: 'playback', label: msg('Skip long songs'), keywords: msg('skip long songs minutes length duration mix') },
  { section: 'playback', label: msg('Fade between songs'), keywords: msg('crossfade transition fade out in') },
  { section: 'playback', label: msg('Early endings'), keywords: msg('silence end screen outro video ends early custom end detect') },
  { section: 'playback', label: msg('Skip silence'), keywords: msg('silence quiet start end intro outro gap trim skip hidden track gapless') },
  { section: 'playback', label: msg('Skip non-music parts'), keywords: msg('sponsorblock intro skit talking outro music video skip segments community') },
  { section: 'appearance', label: msg('Tuner scale'), keywords: msg('progress bar seek') },
  { section: 'appearance', label: msg('Immersive player'), keywords: msg('blur blurred background cover now playing ambient') },
  { section: 'appearance', label: msg('Cover tint'), keywords: msg('ambient background color now playing') },
  { section: 'appearance', label: msg('Mini player'), keywords: msg('floating card video') },
  { section: 'appearance', label: msg('Mini player place'), keywords: msg('sidebar docked floating video corner') },
  { section: 'appearance', label: msg('Progress bar'), keywords: msg('seek bar squiggly wave line progress style waveform shape') },
  { section: 'appearance', label: msg('Covers in lists'), keywords: msg('thumbnails artwork rows') },
  { section: 'appearance', label: msg('Clock on the cover display'), keywords: msg('clock time hour day second screen monitor full screen big cover display') },
  { section: 'appearance', label: msg('Column browser'), keywords: msg('artists albums panes filter') },
  { section: 'appearance', label: msg('Whole app in the cover’s color'), keywords: msg('tint ambient background color theme cover everywhere') },
  { section: 'playback', label: msg('Play with'), keywords: msg('single double click row') },
  { section: 'appearance', label: msg('Counts in the sidebar'), keywords: msg('numbers songs') },
  { section: 'general', label: msg('Open on'), keywords: msg('start screen launch home') },
  { section: 'general', label: msg('Update channel'), keywords: msg('beta stable release early preview prerelease testing new features updates version') },
  { section: 'general', label: msg('Cover cache size'), keywords: msg('covers pictures images artwork cache disk space storage size limit clear delete empty free') },
  { section: 'general', label: msg('Back up your library'), keywords: msg('backup save copy export file library playlists likes history move new pc computer') },
  { section: 'general', label: msg('Restore a backup'), keywords: msg('restore backup import file library replace') },
  { section: 'general', label: msg('Clear covers'), keywords: msg('covers pictures images artwork cache disk space storage size limit clear delete empty free') },
  { section: 'appearance', label: msg('Animations'), keywords: msg('motion transitions reduce') },
  { section: 'appearance', label: msg('List columns'), keywords: msg('album sources duration') },
  { section: 'sources', label: 'YouTube Music', keywords: msg('google sign in account import playlists sync liked') },
  { section: 'sources', label: msg('Update every 15 minutes'), keywords: msg('automatic auto sync refresh background youtube music playlists liked minutes') },
  { section: 'sources', label: msg('Sync direction'), keywords: msg('two way one way both import only send only push pull upload download off account') },
  { section: 'sources', label: 'Spotify', keywords: msg('client id key premium connect') },
  { section: 'sync', label: 'OneDrive', keywords: msg('sync other pc computer cloud password encrypted backup') },
  { section: 'sync', label: msg('Your devices'), keywords: msg('phone mobile android iphone pair qr code wifi network trusted automatic other pc computer laptop') },
  { section: 'sources', label: msg('Spotify web player'), keywords: msg('sign in') },
  { section: 'sources', label: msg('Apple Music'), keywords: msg('apple itunes import playlists favorite songs sign in') },
  { section: 'sources', label: msg('Local files'), keywords: msg('music folder mp3 flac scan') },
  { section: 'shield', label: msg('Block ads and trackers'), keywords: msg('adblock shield easylist privacy') },
  { section: 'privacy', label: msg('The app'), keywords: msg('privacy network hosts servers connections today') },
  { section: 'privacy', label: msg('App windows'), keywords: msg('privacy network hosts requests blocked pages') },
  ...ACTIONS.map((a): SettingEntry => ({ section: 'shortcuts', label: a.label, keywords: msg('keyboard shortcut hotkey global background'), extra: a.keys ? comboLabel(a.keys) : undefined })),
  { section: 'about', label: msg('Automatic updates'), keywords: msg('update version upgrade install new release') },
  { section: 'about', label: msg('App status'), keywords: msg('stats cache memory songs playlists listens') },
  { section: 'about', label: msg('About'), keywords: msg('version license github source privacy') },
  { section: 'about', label: msg('Third-party licenses'), keywords: msg('open source credits notices attribution copyright mit apache mpl fonts') },
  { section: 'about', label: msg('Copy diagnostics'), keywords: msg('diagnostics log errors crash bug report support debug clipboard') },
  { section: 'playback', label: msg('Smart shuffle'), keywords: msg('shuffle random artist spread same artist twice recently played repeat') },
  { section: 'playback', label: msg('Songs heard lately'), keywords: msg('auto-dj autodj recently played wait days week month') },
  { section: 'playback', label: msg('Your ratings count'), keywords: msg('auto-dj autodj stars rating favourite weight') },
  { section: 'playback', label: msg('Same artist again'), keywords: msg('auto-dj autodj artist repeat spread apart') },
  { section: 'playback', label: msg('Pause during calls'), keywords: msg('call teams skype meeting communications ducking lower volume pause') },
  { section: 'playback', label: msg('Phone remote'), keywords: msg('phone mobile remote control qr code wifi network lan couch') },
  { section: 'playback', label: msg('Streaming overlay'), keywords: msg('obs stream streaming twitch browser source now playing overlay') },
  { section: 'playback', label: msg('Visualizer on the overlay'), keywords: msg('obs stream bars spectrum equalizer') },
  { section: 'playback', label: msg('Pause when headphones disconnect'), keywords: msg('headphones unplug bluetooth headset speaker disconnect jack output device pause') },
  { section: 'playback', label: msg('No fade within an album'), keywords: msg('album gapless crossfade fade live continuous concert mix dip') },
  { section: 'playback', label: msg('Advanced fade'), keywords: msg('fade curve crossfade graph volume shape equal power exponential logarithmic s-curve dj') },
  { section: 'playback', label: msg('Fade in after a skip'), keywords: msg('fade manual next pick') },
  { section: 'playback', label: msg('Fade on pause and play'), keywords: msg('fade pause unpause smooth glide') },
  { section: 'playback', label: msg('Sound processing'), keywords: msg('audio live effects dsp') },
  { section: 'playback', label: msg('Adaptive Sound'), keywords: msg('loudness normalize normalization volume level even agc auto gain lufs') },
  { section: 'playback', label: msg('Adaptive Sound level'), keywords: msg('loudness target quiet normal loud lufs') },
  { section: 'playback', label: msg('Volume levelling'), keywords: msg('replaygain replay gain loudness normalize normalization volume level same lufs album track r128') },
  { section: 'playback', label: msg('Moving cover'), keywords: msg('animation pulse beat visualizer artwork react music') },
  { section: 'playback', label: msg('Visualizer'), keywords: msg('spectrum bars equalizer analyzer frequencies audio visualiser music moving') },
  { section: 'playback', label: msg('Visualizer style'), keywords: msg('bars mirror peaks wave curve radial circle particles vu needles meter spectrogram waterfall oscilloscope scope vectorscope goniometer stereo phase correlation loudness lufs look ppm programme') },
  { section: 'playback', label: msg('Meter face'), keywords: msg('dial skin vintage retro analog backlit hifi needles') },
  { section: 'playback', label: msg('Visualizer weighting'), keywords: msg('tilt slope bass treble highs lows balance hearing curve a-weighting itu 468') },
  { section: 'playback', label: msg('Visualizer color'), keywords: msg('colour tint hue palette accent cover album art') },
  { section: 'playback', label: msg('Visualizer gradient'), keywords: msg('rainbow prism spectrum meter red top warm colours') },
  { section: 'playback', label: msg('Visualizer bands'), keywords: msg('octave third sixth twelfth analyzer resolution detail hertz decibel scale') },
  { section: 'playback', label: msg('Visualizer reflection'), keywords: msg('glossy floor mirror shine') },
  { section: 'playback', label: msg('Visualizer behind Now Playing'), keywords: msg('backdrop background big wall faint') },
  { section: 'playback', label: msg('Visualizer in the mini player'), keywords: msg('small strip corner panel sidebar') },
  { section: 'playback', label: msg("Process YouTube's sound"), keywords: msg('audio live youtube video processing') },
  { section: 'appearance', label: msg('Background blur'), keywords: msg('immersive blurry flou sharp') },
  { section: 'appearance', label: msg('Background dimming'), keywords: msg('immersive dark veil brightness') },
  { section: 'appearance', label: msg('Background motion'), keywords: msg('immersive animation drift') },
  { section: 'appearance', label: msg('Mix covers'), keywords: msg('mixes artwork grid daily template image') },
  { section: 'general', label: msg('Open at startup'), keywords: msg('launch boot login sign in windows task manager autostart start automatically') },
  { section: 'general', label: msg('Keep running in the notification area'), keywords: msg('tray background close minimize system tray quit discord') },
  { section: 'general', label: msg('Reopen where you left off'), keywords: msg('restore state screen last session launch') },
  { section: 'general', label: msg('Resume playback on launch'), keywords: msg('restore continue reopen last track start') },
  { section: 'general', label: msg('Notification position'), keywords: msg('toast popup message where place corner bottom top right') },
  { section: 'general', label: msg('Which notifications'), keywords: msg('toast popup messages fewer quiet annoying errors only important') },
  { section: 'general', label: msg('How long notifications stay'), keywords: msg('toast popup message time seconds duration short long') },
  { section: 'general', label: msg('Remember recent searches'), keywords: msg('history recent forget clear privacy search bar') },
  { section: 'general', label: msg('Over the cover in Now Playing'), keywords: msg('search bar center middle player cover video align') },
  { section: 'general', label: msg('Search suggestions'), keywords: msg('autocomplete suggest typing google youtube privacy search bar') },
  { section: 'general', label: msg('Voice search'), keywords: msg('mic microphone speech speak dictation privacy') },
  { section: 'general', label: msg('Music Detector'), keywords: msg('identify recognize song shazam microphone audd listen what song') },
  { section: 'playback', label: msg('Subtitles on videos'), keywords: msg('captions cc closed') },
  { section: 'playback', label: msg('YouTube controls on the video'), keywords: msg('overlay title buttons hover embed') },
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
