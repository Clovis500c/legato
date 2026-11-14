import type { SettingsSection } from '../../app/store'
import { msg } from '../../shared/i18n/i18n'

/**
 * Where every setting lives (plan-v2 › Settings reorganised, structure 1): one table, read by the page, the search and
 * the tests. A category is a page of Settings; a group is a titled block on it (its English title is its id, its
 * `data-setting`); a setting is a row (its English label, `data-setting`). The page draws a group where this table puts
 * it, whatever component holds its JSX: moving a group to another page or place is a line here. `advanced`: folded at
 * the page's foot under Advanced. `was`: the group a setting sat in before (the search still finds it by that name).
 * Pure: no `window`, imported by tests.
 */

export type Category = SettingsSection

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'general', label: msg('General') },
  { id: 'playback', label: msg('Playback') },
  { id: 'appearance', label: msg('Appearance') },
  { id: 'features', label: msg('Features') },
  { id: 'devices', label: msg('Devices') },
  { id: 'library', label: msg('Library and storage') },
  { id: 'sources', label: msg('Accounts') },
  { id: 'sync', label: msg('Sync Mode') },
  { id: 'shield', label: msg('Shield') },
  { id: 'privacy', label: msg('Privacy') },
  { id: 'shortcuts', label: msg('Shortcuts') },
  { id: 'about', label: msg('About') },
]

export interface GroupDef {
  id: string
  /** Shown text (English, translated by tr), when it differs from the id; the id stays its data-setting and key. */
  label?: string
  /** The label's translations aren't written yet: a plain string (not msg), shown in English meanwhile. */
  toTranslate?: true
  category: Category
  advanced?: true
}

/** On each page in this order. */
export const GROUPS: GroupDef[] = [
  { id: 'Language', category: 'general' },
  { id: 'Starting and closing', category: 'general' },
  { id: 'Updates', category: 'general' },
  { id: 'Notifications', category: 'general' },
  { id: 'Fades', category: 'playback' },
  { id: 'Clicks', category: 'playback' },
  { id: 'Up next', category: 'playback' },
  { id: 'Auto-DJ', category: 'playback' },
  { id: 'Volume and output', category: 'playback' },
  { id: 'Sound processing', category: 'playback' },
  { id: 'YouTube videos', category: 'playback' },
  { id: 'Song details', category: 'playback', advanced: true },
  { id: 'Theme', category: 'appearance' },
  { id: 'Accent color', category: 'appearance' },
  { id: 'Font', category: 'appearance' },
  { id: 'Covers', category: 'appearance' },
  { id: 'List density', category: 'appearance' },
  { id: 'Text size', category: 'appearance' },
  { id: 'Interface size', category: 'appearance' },
  { id: 'Player', category: 'appearance' },
  { id: 'Immersive player', category: 'appearance' },
  { id: 'Hi-Fi extras', category: 'appearance' },
  { id: 'Lists and navigation', category: 'appearance' },
  { id: 'Mixes', category: 'appearance' },
  { id: 'List columns', category: 'appearance', advanced: true },
  { id: 'Pages and modes', category: 'features' },
  { id: 'Sharing', category: 'features' },
  { id: 'Search bar', category: 'features' },
  { id: 'Voice and recognition', category: 'features' },
  { id: 'Alarm', category: 'features' },
  { id: 'Screen', category: 'features' },
  { id: 'Casting and pairing', category: 'devices' },
  { id: 'Headphones and calls', category: 'devices' },
  { id: 'Phone remote', category: 'devices' },
  { id: 'Streaming overlay', category: 'devices' },
  { id: 'Library backup', category: 'library' },
  { id: 'Cover cache', category: 'library' },
  { id: 'Storage', category: 'library', advanced: true },
]

export interface SettingDef {
  /**
   * The row's (or group's) id: its `data-setting`, its translation key until it has a label, its search key. Stays
   * English and stable (Sync Mode, links, the search's old name): rename a setting with `label`, never here.
   */
  id: string
  /** Shown text (English, translated by tr), when it differs from the id. The search finds both. */
  label?: string
  /** The label's translations aren't written yet: a plain string (not msg), shown in English meanwhile. */
  toTranslate?: true
  /** Its group's id, or a category for a page drawn by its own component (Accounts, Sync Mode, Privacy, About…). */
  in: string
  keywords?: string
  /** The group it sat in before the reorganisation: still found by that name. */
  was?: string
}

export const SETTINGS: SettingDef[] = [
  { id: msg('Language'), in: 'Language', keywords: msg('language translation translate english french interface') },
  { id: msg('Theme'), in: 'Theme', keywords: msg('dark light mode windows color themes editor custom colors import export palette contrast picture background image wallpaper corners css') },
  { id: msg('Accent color'), in: 'Accent color', keywords: msg('colour highlight windows') },
  { id: msg('Font'), in: 'Font', keywords: msg('typeface roboto text') },
  { id: msg('Covers'), in: 'Covers', keywords: msg('cover shape round vinyl sharp artwork') },
  { id: msg('List density'), in: 'List density', keywords: msg('compact rows spacing') },
  { id: msg('Text size'), in: 'Text size', keywords: msg('font bigger smaller readable letters') },
  { id: msg('Interface size'), in: 'Interface size', keywords: msg('zoom scale bigger smaller') },
  { id: msg('Hi-Fi extras'), in: 'Hi-Fi extras', keywords: msg('hifi extras player details touches') },
  { id: msg('Source icon'), in: 'Hi-Fi extras', keywords: msg('readout source format youtube local display') },
  { id: msg('Volume control'), in: 'Hi-Fi extras', keywords: msg('knob bar slider sound') },
  { id: msg('Sleep timer button'), in: 'Hi-Fi extras', keywords: msg('moon sleep timer button hide') },
  { id: msg('Skip long songs'), in: 'Up next', keywords: msg('skip long songs minutes length duration mix') },
  { id: msg('Scan QR codes with the webcam'), in: 'Casting and pairing', keywords: msg('webcam camera qr scan code pair room'), was: 'Up next' },
  { id: msg('Equalizer per output device'), in: 'Volume and output', keywords: msg('equalizer eq output device headphones speakers preset'), was: 'Up next' },
  { id: msg('Cast to speakers'), in: 'Casting and pairing', keywords: msg('cast dlna upnp speaker tv network'), was: 'Up next' },
  { id: msg('Translate lyrics'), in: 'Song details', keywords: msg('translate translation lyrics language'), was: 'Up next' },
  { id: msg('Chapters of long YouTube videos'), in: 'YouTube videos', keywords: msg('chapters timestamps dj set mix long video parts'), was: 'Up next' },
  { id: msg('Estimate tempo'), in: 'Song details', keywords: msg('estimate tempo bpm analysis rhythm beat'), was: 'Up next' },
  { id: msg('Volume per source'), in: 'Volume and output', keywords: msg('volume per source remember files youtube spotify different'), was: 'Up next' },
  { id: msg('Volume per output device'), in: 'Volume and output', keywords: msg('volume per output device speakers headphones remember'), was: 'Up next' },
  { id: msg('Focus and workout sessions'), in: 'Pages and modes', keywords: msg('focus workout session timer study run sport'), was: 'Up next' },
  { id: msg('Last.fm suggestions'), in: 'Pages and modes', keywords: msg('lastfm discoveries similar artists new music'), was: 'Up next' },
  { id: msg('Blind test'), in: 'Pages and modes', keywords: msg('blind test guess game quiz music snippet'), was: 'Up next' },
  { id: msg('Podcasts'), in: 'Pages and modes', keywords: msg('podcasts rss feed episodes show audio'), was: 'Up next' },
  { id: msg('Fade between songs'), in: 'Fades', keywords: msg('crossfade transition fade out in') },
  { id: msg('Sweet fades'), in: 'Fades', keywords: msg('fade crossfade tempo bpm beat dj'), was: 'Up next' },
  { id: msg('Early endings'), in: 'Fades', keywords: msg('silence end screen outro video ends early custom end detect') },
  { id: msg('Skip silence'), in: 'Fades', keywords: msg('silence quiet start end intro outro gap trim skip hidden track gapless') },
  { id: msg('Skip non-music parts'), in: 'Fades', keywords: msg('sponsorblock intro skit talking outro music video skip segments community') },
  { id: msg('Tuner scale'), in: 'Hi-Fi extras', keywords: msg('progress bar seek') },
  { id: msg('Glow'), in: 'Player', keywords: msg('glow light halo shine neon bloom') },
  { id: msg('Immersive player'), in: 'Immersive player', keywords: msg('blur blurred background cover now playing ambient') },
  { id: msg('Cover tint'), in: 'Player', keywords: msg('ambient background color now playing') },
  { id: msg('Mini player'), in: 'Player', keywords: msg('floating card video') },
  { id: msg('Mini player place'), in: 'Player', keywords: msg('sidebar docked floating video corner') },
  { id: msg('Progress bar'), in: 'Player', keywords: msg('seek bar squiggly wave line progress style waveform shape') },
  { id: msg('Covers in lists'), in: 'Lists and navigation', keywords: msg('thumbnails artwork rows') },
  { id: msg('Clock on the cover display'), in: 'Player', keywords: msg('clock time hour day second screen monitor full screen big cover display') },
  { id: msg('Column browser'), in: 'Lists and navigation', keywords: msg('artists albums panes filter') },
  { id: msg('Covers for new releases'), in: 'Lists and navigation', keywords: msg('cover art archive coverartarchive new releases artists pictures images privacy') },
  { id: msg('Hide explicit songs'), in: 'Lists and navigation', keywords: msg('explicit lyrics parental clean children kids family') },
  { id: msg('Whole app in the cover’s color'), in: 'Player', keywords: msg('tint ambient background color theme cover everywhere') },
  { id: msg('Play with'), in: 'Clicks', keywords: msg('single double click row') },
  { id: msg('Sidebar entries'), in: 'Lists and navigation', keywords: msg('hide show menu left home mixes radio stats add music sections') },
  { id: msg('Counts in the sidebar'), in: 'Lists and navigation', keywords: msg('numbers songs') },
  { id: msg('Open on'), in: 'Starting and closing', keywords: msg('start screen launch home') },
  { id: msg('Update channel'), in: 'Updates', keywords: msg('beta stable release early preview prerelease testing new features updates version') },
  { id: msg('Cover cache size'), in: 'Cover cache', keywords: msg('covers pictures images artwork cache disk space storage size limit clear delete empty free') },
  { id: msg('Back up your library'), in: 'Library backup', keywords: msg('backup save copy export file library playlists likes history move new pc computer') },
  { id: msg('Restore a backup'), in: 'Library backup', keywords: msg('restore backup import file library replace') },
  { id: msg('Clear covers'), in: 'Cover cache', keywords: msg('covers pictures images artwork cache disk space storage size limit clear delete empty free') },
  { id: msg('Your library'), in: 'Storage', keywords: msg('library database disk space storage size') },
  { id: msg('Lyrics and song analyses'), in: 'Storage', keywords: msg('lyrics sponsorblock waveform loudness silence cache clear storage disk space') },
  { id: msg('Diagnostics log'), in: 'Storage', keywords: msg('log logs diagnostics report clear storage') },
  { id: msg('Animations'), in: 'Lists and navigation', keywords: msg('motion transitions reduce') },
  { id: msg('Right-click menus'), in: 'Lists and navigation', keywords: msg('context menu right click items essentials full detail more customize hide reorder') },
  { id: msg('Playlists as banners'), in: 'Lists and navigation', keywords: msg('banner banners playlist carousel steam collage covers tiles browse category') },
  { id: msg('List columns'), in: 'List columns', keywords: msg('album sources duration') },
  { id: 'YouTube Music', in: 'sources', keywords: msg('google sign in account import playlists sync liked') },
  { id: msg('Update every 15 minutes'), in: 'sources', keywords: msg('automatic auto sync refresh background youtube music playlists liked minutes') },
  { id: msg('Sync direction'), in: 'sources', keywords: msg('two way one way both import only send only push pull upload download off account') },
  { id: 'Spotify', in: 'sources', keywords: msg('client id key premium connect') },
  { id: 'OneDrive', in: 'sync', keywords: msg('sync other pc computer cloud password encrypted backup') },
  { id: msg('Your devices'), in: 'sync', keywords: msg('phone mobile android iphone pair qr code wifi network trusted automatic other pc computer laptop') },
  { id: msg('Spotify web player'), in: 'sources', keywords: msg('sign in') },
  { id: msg('Apple Music'), in: 'sources', keywords: msg('apple itunes import playlists favorite songs sign in') },
  { id: msg('Local files'), in: 'sources', keywords: msg('music folder mp3 flac scan') },
  { id: msg('Your music server'), in: 'sources', keywords: msg('navidrome subsonic airsonic gonic ampache nas self-hosted stream own server') },
  { id: msg('Block ads and trackers'), in: 'shield', keywords: msg('adblock shield easylist privacy') },
  { id: msg('The app'), in: 'privacy', keywords: msg('privacy network hosts servers connections today') },
  { id: msg('App windows'), in: 'privacy', keywords: msg('privacy network hosts requests blocked pages') },
  { id: msg('Automatic updates'), in: 'about', keywords: msg('update version upgrade install new release') },
  { id: msg('App status'), in: 'about', keywords: msg('stats cache memory songs playlists listens') },
  { id: msg('About'), in: 'about', keywords: msg('version license github source privacy') },
  { id: msg('Third-party licenses'), in: 'about', keywords: msg('open source credits notices attribution copyright mit apache mpl fonts') },
  { id: msg('Copy diagnostics'), in: 'about', keywords: msg('diagnostics log errors crash bug report support debug clipboard') },
  { id: msg('Smart shuffle'), in: 'Up next', keywords: msg('shuffle random artist spread same artist twice recently played repeat') },
  { id: msg('Songs heard lately'), in: 'Auto-DJ', keywords: msg('auto-dj autodj recently played wait days week month') },
  { id: msg('Your ratings count'), in: 'Auto-DJ', keywords: msg('auto-dj autodj stars rating favourite weight') },
  { id: msg('Alarm'), in: 'Alarm', keywords: msg('alarm clock wake up wakeup morning ring rise sunrise') },
  { id: msg('Same artist again'), in: 'Auto-DJ', keywords: msg('auto-dj autodj artist repeat spread apart') },
  { id: msg('Pause during calls'), in: 'Headphones and calls', keywords: msg('call teams skype meeting communications ducking lower volume pause') },
  { id: msg('Keep the screen on'), in: 'Screen', keywords: msg('screen display awake sleep lock turn off standby dim monitor') },
  { id: msg('Phone remote'), in: 'Phone remote', keywords: msg('phone mobile remote control qr code wifi network lan couch') },
  { id: msg('Streaming overlay'), in: 'Streaming overlay', keywords: msg('obs stream streaming twitch browser source now playing overlay') },
  { id: msg('Visualizer on the overlay'), in: 'Streaming overlay', keywords: msg('obs stream bars spectrum equalizer') },
  { id: msg('Pause when headphones disconnect'), in: 'Headphones and calls', keywords: msg('headphones unplug bluetooth headset speaker disconnect jack output device pause') },
  { id: msg('No fade within an album'), in: 'Fades', keywords: msg('album gapless crossfade fade live continuous concert mix dip') },
  { id: msg('Advanced fade'), in: 'Fades', keywords: msg('fade curve crossfade graph volume shape equal power exponential logarithmic s-curve dj') },
  { id: msg('Fade in after a skip'), in: 'Fades', keywords: msg('fade manual next pick') },
  { id: msg('Fade on pause and play'), in: 'Fades', keywords: msg('fade pause unpause smooth glide') },
  { id: msg('Sound processing'), in: 'Sound processing', keywords: msg('audio live effects dsp') },
  { id: msg('Adaptive Sound'), in: 'Sound processing', keywords: msg('loudness normalize normalization volume level even agc auto gain lufs') },
  { id: msg('Adaptive Sound level'), in: 'Sound processing', keywords: msg('loudness target quiet normal loud lufs') },
  { id: msg('Volume levelling'), in: 'Sound processing', keywords: msg('replaygain replay gain loudness normalize normalization volume level same lufs album track r128') },
  { id: msg('Moving cover'), in: 'Sound processing', keywords: msg('animation pulse beat visualizer artwork react music') },
  { id: msg('Visualizer'), in: 'Sound processing', keywords: msg('spectrum bars equalizer analyzer frequencies audio visualiser music moving') },
  { id: msg('Visualizer style'), in: 'Sound processing', keywords: msg('bars mirror peaks wave curve radial circle particles vu needles meter spectrogram waterfall oscilloscope scope vectorscope goniometer stereo phase correlation loudness lufs look ppm programme terrain 3d landscape') },
  { id: msg('Meter face'), in: 'Sound processing', keywords: msg('dial skin vintage retro analog backlit hifi needles') },
  { id: msg('Spectrogram colors'), in: 'Sound processing', keywords: msg('colormap color map magma viridis heat waterfall palette') },
  { id: msg('Visualizer preset'), in: 'Sound processing', keywords: msg('milkdrop milk presets import export tunnel spiral aurora flow zoom') },
  { id: msg('Preset colors'), in: 'Sound processing', keywords: msg('milkdrop presets colours own theme ink') },
  { id: msg('Visualizer weighting'), in: 'Sound processing', keywords: msg('tilt slope bass treble highs lows balance hearing curve a-weighting itu 468') },
  { id: msg('Visualizer color'), in: 'Sound processing', keywords: msg('colour tint hue palette accent cover album art') },
  { id: msg('Visualizer gradient'), in: 'Sound processing', keywords: msg('rainbow prism spectrum meter red top warm colours') },
  { id: msg('Visualizer bands'), in: 'Sound processing', keywords: msg('octave third sixth twelfth analyzer resolution detail hertz decibel scale') },
  { id: msg('Visualizer reflection'), in: 'Sound processing', keywords: msg('glossy floor mirror shine') },
  { id: msg('Visualizer behind Now Playing'), in: 'Sound processing', keywords: msg('backdrop background big wall faint') },
  { id: msg('Visualizer in the mini player'), in: 'Sound processing', keywords: msg('small strip corner panel sidebar') },
  { id: msg("Process YouTube's sound"), in: 'Sound processing', keywords: msg('audio live youtube video processing') },
  { id: msg('Background blur'), in: 'Immersive player', keywords: msg('immersive blurry flou sharp') },
  { id: msg('Background dimming'), in: 'Immersive player', keywords: msg('immersive dark veil brightness') },
  { id: msg('Background motion'), in: 'Immersive player', keywords: msg('immersive animation drift') },
  { id: msg('Flowing background behind Home'), in: 'Immersive player', keywords: msg('home page liquid fluid warp shader cover colours') },
  { id: msg('Flowing background'), in: 'Immersive player', keywords: msg('immersive liquid fluid warp shader webgl') },
  { id: msg('Mix covers'), in: 'Mixes', keywords: msg('mixes artwork grid daily template image') },
  { id: msg('Open at startup'), in: 'Starting and closing', keywords: msg('launch boot login sign in windows task manager autostart start automatically') },
  { id: msg('Keep running in the notification area'), in: 'Starting and closing', keywords: msg('tray background close minimize system tray quit discord') },
  { id: msg('Picture-in-picture on minimize'), in: 'Starting and closing', keywords: msg('minimize pip small window above on top floating corner player') },
  { id: msg('Classic mini player'), in: 'Starting and closing', keywords: msg('winamp skin retro compact strip pip scroller old school') },
  { id: msg('Reopen where you left off'), in: 'Starting and closing', keywords: msg('restore state screen last session launch') },
  { id: msg('Living-room mode'), in: 'Pages and modes', keywords: msg('living room tv television arrows remote gamepad big screen 10 foot'), was: 'Starting and closing' },
  { id: msg('Audiobooks'), in: 'Pages and modes', keywords: msg('audiobooks book audio reading chapters spoken'), was: 'Starting and closing' },
  { id: msg('TV home'), in: 'Pages and modes', keywords: msg('tv home living room tiles gamepad television'), was: 'Starting and closing' },
  { id: msg('Check podcasts'), in: 'Pages and modes', keywords: msg('podcasts check new episodes feed background'), was: 'Starting and closing' },
  { id: msg('Discord sign-in'), in: 'Sharing', keywords: msg('discord sign in login profile name share shared by account'), was: 'Starting and closing' },
  { id: msg('Resume playback on launch'), in: 'Starting and closing', keywords: msg('restore continue reopen last track start') },
  { id: msg('Notification position'), in: 'Notifications', keywords: msg('toast popup message where place corner bottom top right') },
  { id: msg('Which notifications'), in: 'Notifications', keywords: msg('toast popup messages fewer quiet annoying errors only important') },
  { id: msg('How long notifications stay'), in: 'Notifications', keywords: msg('toast popup message time seconds duration short long') },
  { id: msg('Remember recent searches'), in: 'Search bar', keywords: msg('history recent forget clear privacy search bar') },
  { id: msg('Search suggestions'), in: 'Search bar', keywords: msg('autocomplete suggest typing google youtube privacy search bar') },
  { id: msg('Voice search'), in: 'Voice and recognition', keywords: msg('mic microphone speech speak dictation privacy') },
  { id: msg('Music Detector'), in: 'Voice and recognition', keywords: msg('identify recognize song shazam microphone audd listen what song') },
  { id: msg('Ask this PC’s media players first'), in: 'Voice and recognition', keywords: msg('media session smtc now playing metadata detector spotify browser vlc identify') },
  { id: msg('Name songs with AcoustID (free)'), in: 'Voice and recognition', keywords: msg('acoustid musicbrainz chromaprint fingerprint free identify recognize shazam detector') },
  { id: msg('Subtitles on videos'), in: 'YouTube videos', keywords: msg('captions cc closed') },
  { id: msg('YouTube controls on the video'), in: 'YouTube videos', keywords: msg('overlay title buttons hover embed') },
  { id: msg('Volume and output'), in: 'Volume and output', keywords: msg('volume output device equalizer eq speakers headphones remember') },
  { id: msg('Song details'), in: 'Song details', keywords: msg('lyrics translation tempo bpm analysis') },
  { id: msg('Casting and pairing'), in: 'Casting and pairing', keywords: msg('cast dlna speakers webcam qr pair') },
  { id: msg('Pages and modes'), in: 'Pages and modes', keywords: msg('pages modes podcasts audiobooks blind test focus living room tv') },
  { id: msg('Sharing'), in: 'Sharing', keywords: msg('discord share profile') },
]

const GROUP = new Map(GROUPS.map((g, i) => [g.id, { ...g, index: i }]))
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id))

/** A group's place: its page, its rank on it, folded or not. Undefined: not in the table (the tests forbid it). */
export const groupDef = (id: string) => GROUP.get(id)

/** The page a setting, a group or a category id is on. */
export function categoryOf(id: string): Category | undefined {
  const s = SETTINGS.find((e) => e.id === id)
  const where = s ? s.in : id
  return GROUP.get(where)?.category ?? (CATEGORY_IDS.has(where) ? (where as Category) : undefined)
}

const LABEL = new Map<string, string>([...GROUPS, ...SETTINGS].filter((e) => e.label).map((e) => [e.id, e.label!]))

/** The English text shown for a setting or group id (translate it with tr): its label, or the id itself. */
export const labelOf = (id: string) => LABEL.get(id) ?? id

/** Labels a language lacks that aren't marked toTranslate (i18n.test.ts asks each of the 19 for none). */
export const missingLabels = (table: Record<string, string>, defs: (GroupDef | SettingDef)[] = [...GROUPS, ...SETTINGS]) =>
  defs.filter((e) => e.label && !e.toTranslate && !(e.label in table)).map((e) => e.label!)
