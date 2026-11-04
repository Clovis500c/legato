import type { ReactNode } from 'react'

// Every line here is something the app does today (checked against the code, 2026-10-29). Privacy rows replace
// docs/privacy.md: keep them in step with what the app sends.

export const GITHUB = 'https://github.com/Clovis500c/legato'

export const FIXES: [string, string][] = [
  ['Fewer songs on screen after each redesign', 'A compact list by default: 40 px rows, artist and album in their own columns, the columns you pick.'],
  ['Queued songs land at the end', 'What you add plays next, in its own block above the rest of the queue, and comes back after a restart.'],
  ['No light mode, after years of asking', 'Light and dark, both designed, following Windows unless you pick one.'],
  ['The like button was taken away', "A heart on every row and in the player, one click. Signed in to YouTube Music, it's a real like there."],
  ['Lyrics hidden behind a tab', 'Timed lyrics beside any page, from YouTube Music or LRCLIB.'],
]

export type IconName = 'Playlist' | 'Sparkle' | 'FolderSimple' | 'Devices' | 'PuzzlePiece' | 'Translate'

/** What the scroll story doesn't show. */
export const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'Playlist', title: 'Playlists', text: 'Import from a service, a file (M3U, XSPF, CSV) or iTunes and MusicBee; create, pin, sort into folders, save as a file, export to YouTube Music, share by link or QR code. Smart playlists fill themselves from your plays and star ratings.' },
  { icon: 'Sparkle', title: 'Mixes, radios and an Auto-DJ', text: 'Daily mixes, mixes for this time of day and this weekday, endless radios from a song, an album, an artist or a playlist, and an Auto-DJ that keeps your library playing by your rules. All made on your PC, with stats from what you play and Last.fm or ListenBrainz scrobbling if you want it.' },
  { icon: 'FolderSimple', title: 'Your own files', text: 'Gapless playback, as loud as your streamed songs (their ReplayGain tags, or measured), and their tags to edit, a whole album at once: artist, album, genre, year, track numbers, cover. Their own lyrics come first: edit them, or time plain ones by tapping along.' },
  { icon: 'Devices', title: 'Sync Mode', text: 'Your library on all your PCs, through a OneDrive folder or your network.' },
  { icon: 'PuzzlePiece', title: 'Add-ons and plugins', text: 'Plugins by others ask for what they need before they can do anything.' },
  { icon: 'Translate', title: '18 languages', text: 'Following Windows, with its media keys, a tray icon and full screen. The music pauses when your headphones disconnect, or when a call starts if you want, and your phone can be the remote.' },
]

/** Where the window stands: x, y from the stage's middle (share of it), degrees, zoom on the fitted size. */
export type Pose = { x: number; y: number; rx: number; ry: number; zoom: number }

/** The scroll story, in order: what each chapter says, the demo's screen (site/demo/scenes.ts), where the window goes. Its text sits on the other side. */
export const CHAPTERS: { scene: string; title: string; text: string; alt: string; pose: Pose; black?: boolean }[] = [
  { scene: 'library', title: 'One library', text: 'The same song on several services is one track, wherever you saved it. Browse it by artist and album in two panes, as in MusicBee.', alt: "Legato's Songs page: your playlists on the left, one list of songs from every source, Up next on the right.", pose: { x: 0.2, y: 0.02, rx: 3, ry: -9, zoom: 1.08 } },
  { scene: 'import', title: 'Your Spotify lists come over', text: 'Songs land one by one, every list counted. Each is then searched on YouTube, and the ones without a match are kept for later.', alt: 'The import screen: covers landing one by one, the list being read and the songs left.', pose: { x: 0.3, y: 0.02, rx: 2, ry: -6, zoom: 1.16 } },
  { scene: 'search', title: 'One search', text: 'Your library, YouTube Music, YouTube and Apple Music, in one place. Ctrl+K finds the app’s pages, actions and settings too.', alt: 'Search results for one word: a top result, songs and videos, each with where it comes from.', pose: { x: -0.22, y: 0.03, rx: 3, ry: 11, zoom: 1.12 } },
  { scene: 'player', title: 'One queue', text: 'Every source in one list, with crossfade that leaves albums whole and a shuffle that spreads artists. What you add plays next, in its own block, and comes back after a restart.', alt: 'Now Playing: a big cover, the song, its lyrics and the one that plays next.', pose: { x: -0.36, y: 0, rx: 1, ry: 12, zoom: 1.5 } },
  { scene: 'karaoke', title: 'Press K for Karaoke', text: 'Timed lyrics, word by word when LRCLIB has them, in a panel beside any page, big in Now Playing, or full screen like here.', alt: 'Karaoke mode: big lyrics on a blurred cover, the line playing filling up word by word.', pose: { x: 0.17, y: 0, rx: 0, ry: -3, zoom: 1.02 } },
  { scene: 'visualizer', title: 'Press V, lights off', text: 'LED bars, a ring around the cover, VU needles, a spectrogram, full screen.', alt: 'The visualizer full screen: columns of LED bars on a dark page.', pose: { x: 0.17, y: 0, rx: 0, ry: 0, zoom: 1.04 }, black: true },
  { scene: 'editor', title: 'Change a song as it plays', text: 'Speed, pitch, a 10-band EQ, reverb and 3D sound, in the Live Editor.', alt: "The Live Editor beside a big cover: the song's versions, presets, speed and pitch.", pose: { x: -0.22, y: 0, rx: 2, ry: 8, zoom: 1.16 } },
  { scene: 'themes', title: 'Make it look like yours', text: 'Colors, fonts, a picture or video background, your own CSS.', alt: "Legato's Songs page in another theme.", pose: { x: 0.16, y: 0, rx: 0, ry: -2, zoom: 1 } },
]

// Latest row of docs/performance.md (`pnpm bench`), copied as it is: change these with each new row.
export const BENCH = { date: '2026-10-31', version: '1.0.0', os: 'Windows 11', pc: 'Ryzen 5 5500, 32 GB', songs: '10 000', ramPaused: '141', ramTray: '54', windowCold: '0.84', paintCold: '1.26' }

export const WHY: { title: string; text: string }[] = [
  { title: 'Legal', text: "Songs play in the official players: YouTube's own, the Spotify app, and your files in Legato's own. No platform's audio is downloaded, recorded or extracted. The Music Detector listens only when you ask, and Apple's previews are Apple's own 30 s clips." },
  { title: 'Light', text: `${BENCH.ramPaused} MB of RAM with the app open and paused, ${BENCH.ramTray} MB after 10 minutes in the tray, silent. On a cold start the window shows in ${BENCH.windowCold} s and the first screen is painted at ${BENCH.paintCold} s.` },
  { title: 'Your PCs in sync', text: 'Sync Mode keeps your library on every PC through a OneDrive folder or your own network. No account of ours, no server.' },
  { title: 'Your scrobbles', text: 'What you play, from any source, goes to your Last.fm profile with your own free API key, or to ListenBrainz with your token. Off until you connect one.' },
]

/** The Light numbers, big. */
export const FIGURES: [string, string][] = [
  [`${BENCH.ramPaused} MB`, 'of RAM, open and paused'],
  [`${BENCH.ramTray} MB`, 'after 10 minutes in the tray'],
  [`${BENCH.windowCold} s`, 'to the window, cold start'],
  [`${BENCH.paintCold} s`, 'to the first screen, cold start'],
]

/** Under them: where the numbers come from. */
export const WHY_NOTE = `Measured ${BENCH.date} on ${BENCH.os} (${BENCH.pc}), Legato ${BENCH.version}, a library of ${BENCH.songs} songs. RAM is the app and its WebView2 processes together. Other apps were running during the measure, so another PC will differ.`

export const PLAYBACK: [string, string][] = [
  ['YouTube Music and YouTube', "In YouTube's own player, its video in view: in the right panel, or big in Now Playing."],
  ['Spotify', 'Through the Spotify app (Spotify Connect), with Premium and your own app key. Without either, public playlist links and Connect Spotify bring your lists in, and their songs play from YouTube.'],
  ['Apple Music', 'Catalog search and 30-second previews, no account. The full song plays from YouTube when the app finds it there. Connect Apple Music brings your own playlists in.'],
  ['Your files', "The app's own player: gapless, on your PC."],
]

export const PRIVACY: [string, string][] = [
  ['Library and settings', 'Stay on this PC, in a local database. A backup you make in Settings › General is one file, saved where you choose; sign-ins stay out of it.'],
  ['Sign-ins and keys', 'Stay in the Windows Credential Manager.'],
  ['Requests', "Go out through the app's core only: the interface never calls the network by itself. Settings › Privacy lists every host the app and its windows talked to today, and why."],
  ['Search', "What you search for goes to YouTube, YouTube Music and Apple Music, signed in or not, and to YouTube's suggestions as you type (Settings › General turns them off). Recent searches stay on this PC."],
  ['Connect Spotify', "Only when you use it. Exportify, a free open-source tool that isn't ours, opens at exportify.app in an app window. You sign in and accept on Spotify's own page, and it reads your lists through Spotify's official access and makes a file, which the app takes in and deletes. Exportify keeps its Spotify access in that window's storage, on this PC; you can end it at spotify.com/account/apps. Only titles, artists, lengths and covers are kept, then each song is searched on YouTube. Your Liked Songs join Liked Music: signed in to YouTube Music, those not liked there yet are liked on that account at the next sync, unless it's set not to take changes in Settings › Accounts. Spotify's own direction there, Import only or Off, decides whether Connect Spotify brings anything in, and nothing is ever sent back to Spotify."],
  ['Reading Spotify\'s page', "A second way, only if you choose it: you sign in on Spotify's own page and the app reads your lists as that page shows them. Spotify's rules forbid collecting its data with a tool and allow it to close an account that does, so the app says it first."],
  ['Connect Apple Music', "Only when you use it: you sign in on Apple Music's own page (music.apple.com) in an app window, and the app reads your playlists as that page shows them. Apple's terms forbid reading its services with an automated tool, so the app says it first. Only titles, artists, albums, lengths and covers are kept, then each song is searched on YouTube; nothing is sent to Apple. Apple's session stays in that window's storage, on this PC."],
  ['Pasted playlist links', "A public Spotify, Deezer or Apple Music playlist or album link makes the app ask that service for the list: open.spotify.com, api.deezer.com (link.deezer.com for its short links), music.apple.com and itunes.apple.com. Spotify song links copied from its app make it ask open.spotify.com for each song's page, and a SoundCloud song link asks soundcloud.com's public oEmbed for that song's title and artwork. No account; only titles, artists, lengths and covers come back, then each song is searched on YouTube. Cover pictures load from the image hosts of those services."],
  ['Lyrics', "When you open them. A file of yours that carries its own lyrics (in its tags, or an .lrc file beside it) sends nothing. Otherwise YouTube Music's timed lyrics first if you're signed in, then the song's title, artist, album and length go to LRCLIB. Answers stay on your PC."],
  ['Skip non-music parts', "Off until you turn it on. For each YouTube video that plays, the first 4 characters of its id's hash (never the id) go to SponsorBlock, sponsor.ajay.app, to learn the community's marked intros, skits and outros. The answer is kept a week on this PC."],
  ['Scrobbling', "Off until you connect it in Settings › Accounts. Then what plays now and each song you listened to (title, artist, album, length, when) go to Last.fm (ws.audioscrobbler.com) or ListenBrainz (api.listenbrainz.org); ListenBrainz also gets the song's ISRC and the YouTube or Spotify page it played from. Your key or token stays in the Windows Credential Manager."],
  ['Voice search', "Off until you allow it. While it listens, your voice goes to Microsoft through Windows' own speech recognition. The app keeps nothing."],
  ['Music Detector', 'Off until you allow it. 10 seconds of sound, from the microphone or what this PC plays, go once to AudD to name the song. Nothing is saved.'],
  ['Sync Mode', 'Off until you set it up. One file per PC in a folder you pick (OneDrive by default), sealed with your password if you set one. It carries your library, settings and the song you played last with where it stopped, so another PC can pick up from there. Over your network (off until you turn it on), this device tells your others on the same network its name and kind, they pair once with a 6-digit code or a QR code, and every exchange is sealed; nothing goes through the internet.'],
  ['Phone remote', "Off until you turn it on in Settings › Playback. Then this PC answers, on its own network only, the phones that have its link (a secret in its QR code): what plays, its cover and what's next go to them, and their taps come back. Nothing goes through the internet, and a new link ends the old one."],
  ['Streaming overlay', "Off until you turn it on in Settings › Playback. Then a page for OBS on this PC shows what plays and its cover, and the visualizer's bars if you turn them on (measured only while the page is shown); only this PC is answered."],
  ['YouTube embedding check', "When a YouTube song starts, its video id (and the next two) goes to YouTube's oEmbed, to learn whether its owner allows embedding. The answer is kept a day."],
  ['Updates', 'At launch, the app asks GitHub whether a newer version exists, and installs it between two songs.'],
  ['Error log', 'Errors and playback switches are noted in a small log on this PC (5 MB at most). Nothing sends it: Settings › About › Copy diagnostics puts a summary in your clipboard for a bug report, without song titles or account names unless you ask.'],
]

export const SERVICES: [string, string][] = [
  ['YouTube Music', "Sign in with Google, on Google's own page. Several accounts."],
  ['Spotify', "Your own app from the Spotify Developer Dashboard (Premium needed while it's in development mode), or Add music › Connect Spotify or Spotify's own data export, or paste public playlist links."],
  ['Apple Music', 'Catalog search and 30-second previews, and public playlist or album links, no account. For your own playlists: Add music › Connect Apple Music.'],
  ['Deezer', 'Paste a public playlist or album link: its songs come in and play from YouTube. No account.'],
  ['SoundCloud', "Paste a song's link: it comes in and plays from YouTube. No account; SoundCloud shares a playlist's songs only with registered apps."],
  ['Your files', 'Add your music folders, or drop folders and songs from Explorer onto the window; changes in them show up as they happen.'],
  ['Other apps', "Playlist files (M3U, XSPF, CSV) and iTunes' or MusicBee's library file: songs on your PC come as they are, the others play from YouTube."],
]

// Unlike every other list here, what isn't out yet: docs/notes/plan-v2.md › Roadmap, in its order, minus what shipped.
export const ROADMAP: [string, string][] = [
  ['Lyrics', 'A translation under each line, and a song found from a line you remember.'],
  ['Your own music', 'Jellyfin, Navidrome and Subsonic servers, MusicBrainz lookups for your tags.'],
  ['Smarter listening', 'Your songs analysed on your PC (tempo, energy, key) for radios and fades that fit, a path from one artist to another, a yearly recap to share.'],
  ['Around the house', 'Speakers and TVs (DLNA, Chromecast), listening together on the same network, picking up on your other PC where you stopped.'],
  ['Windows polish', 'A Jump List on the taskbar icon, an alarm that wakes you with a playlist, an overlay for OBS, a picture-in-picture player.'],
  ['Phones, Mac and Linux', 'A mobile version, Android first, on the same Rust core; builds for macOS and Linux.'],
]

export const STEPS: [string, string][] = [
  ['Download', 'Run the installer, on Windows 10 or 11. New versions install themselves between two songs.'],
  ['Connect what you use', 'Settings › Accounts: YouTube Music, Spotify, Apple Music and your music folders.'],
  ['Play', 'Search once, queue from anywhere, keep your library on every PC.'],
]

const link = (href: string, text: string) => (
  <a href={href} className="text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink">
    {text}
  </a>
)

export const FAQ: { q: string; a: ReactNode }[] = [
  { q: 'Is it free?', a: 'Yes. The code is on GitHub, source-available: free to use, not open source. Issues and pull requests are welcome.' },
  { q: 'Do I need an account?', a: 'Not one of ours. You sign in to the services you already use, on their own pages.' },
  { q: 'Does it download music?', a: "No. Music plays in each service's own player or from your files. No platform's audio is downloaded, recorded or extracted; only the Music Detector listens, when you ask it to." },
  { q: 'Why does Spotify need Premium and a key?', a: 'Spotify lets other apps play only through its own app, for Premium accounts, and every app needs a free key from its developer dashboard. Without them, paste a public playlist link, or use Connect Spotify in Add music for your private lists and Liked Songs (read what it says first: the rules of Spotify forbid it): the songs play from YouTube when the app finds them there.' },
  { q: 'Mac or Linux?', a: 'Windows 10 and 11 only, for now.' },
  { q: 'Is there an Android version?', a: "A beta, yes: an APK on the download link under the Windows button (Android 8 or later, 64-bit). Open the file on your phone and allow installs from your browser when Android asks; there is no store listing and no automatic update yet, so a new APK installs over the old one. It talks to the same places as the Windows app, keeps its data on the phone, and syncs with your PCs over Wi-Fi from Settings › Sync Mode. iPhone: not yet." },
  { q: 'How do I move to a new PC?', a: 'Sync Mode keeps several PCs alike. For a one-time move: Settings › General › Back up your library, then Restore a backup on the new PC, and sign in to your accounts again.' },
  { q: 'How do updates work?', a: 'The app checks GitHub at launch and installs a new version between two songs, or while nothing plays. You get the versions that were tried first (Stable); Settings › General has a Beta channel that brings every change first, and may break.' },
  { q: 'Can I write a plugin?', a: <>Yes: a folder with a manifest and a script, which asks for its permissions when someone installs it. The guide: {link(`${GITHUB}/blob/master/docs/plugins.md`, 'docs/plugins.md')}.</> },
]
