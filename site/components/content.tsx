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

export type IconName = 'SealCheck' | 'Feather' | 'Headphones' | 'Stack' | 'MagnifyingGlass' | 'PlayCircle' | 'Playlist' | 'Sparkle' | 'SlidersHorizontal' | 'FolderSimple' | 'Devices' | 'Quotes' | 'Palette' | 'PuzzlePiece' | 'Translate'

export const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'Stack', title: 'One library', text: 'The same song on several services is one track, wherever you saved it.' },
  { icon: 'MagnifyingGlass', title: 'One search', text: 'Your library, YouTube Music, YouTube and Apple Music, in one place.' },
  { icon: 'PlayCircle', title: 'One player', text: 'Every source in one queue, with crossfade, lyrics and a visualizer.' },
  { icon: 'Playlist', title: 'Playlists', text: 'Import, create, export to YouTube Music, share by link or QR code.' },
  { icon: 'Sparkle', title: 'Mixes made on your PC', text: 'Daily mixes and stats from what you play, Last.fm scrobbling if you want it.' },
  { icon: 'SlidersHorizontal', title: 'Live Editor', text: 'Speed, pitch, a 10-band EQ, reverb and 3D sound, changed as it plays.' },
  { icon: 'FolderSimple', title: 'Your own files', text: 'Gapless playback, and their title, artist, album and cover to edit.' },
  { icon: 'Devices', title: 'Sync Mode', text: 'Your library on all your PCs, through a OneDrive folder or your network.' },
  { icon: 'Quotes', title: 'Lyrics', text: 'Timed lyrics in a panel beside any page, or big in Now Playing.' },
  { icon: 'Palette', title: 'Themes', text: 'Colors, fonts, a picture or video background, your own CSS.' },
  { icon: 'PuzzlePiece', title: 'Add-ons and plugins', text: 'Plugins by others ask for what they need before they can do anything.' },
  { icon: 'Translate', title: '18 languages', text: 'Following Windows, with its media keys, a tray icon and full screen.' },
]

// Latest row of docs/performance.md (`pnpm bench`), copied as it is: change these with each new row.
export const BENCH = { date: '2026-10-31', version: '1.0.0', os: 'Windows 11', pc: 'Ryzen 5 5500, 32 GB', songs: '10 000', ramPaused: '141', ramTray: '54', windowCold: '0.84', paintCold: '1.26' }

export const WHY: { icon: IconName; title: string; text: string }[] = [
  { icon: 'SealCheck', title: 'Legal', text: "Songs play in the official players: YouTube's own, the Spotify app, and your files in Legato's own. Nothing is downloaded, recorded or extracted." },
  { icon: 'Feather', title: 'Light', text: `${BENCH.ramPaused} MB of RAM with the app open and paused, ${BENCH.ramTray} MB after 10 minutes in the tray, silent. On a cold start the window shows in ${BENCH.windowCold} s and the first screen is painted at ${BENCH.paintCold} s.` },
  { icon: 'Devices', title: 'Your PCs in sync', text: 'Sync Mode keeps your library on every PC through a OneDrive folder or your own network. No account of ours, no server.' },
  { icon: 'Headphones', title: 'Your scrobbles', text: 'What you play, from any source, goes to your Last.fm profile with your own free API key. Off until you connect it.' },
]

/** Under the cards: where the Light numbers come from. */
export const WHY_NOTE = `Measured ${BENCH.date} on ${BENCH.os} (${BENCH.pc}), Legato ${BENCH.version}, a library of ${BENCH.songs} songs. RAM is the app and its WebView2 processes together. Other apps were running during the measure, so another PC will differ.`

export const PLAYBACK: [string, string][] = [
  ['YouTube Music and YouTube', "In YouTube's own player, its video in view: in the right panel, or big in Now Playing."],
  ['Spotify', 'Through the Spotify app (Spotify Connect), with Premium and your own app key. Public playlist links come in without either.'],
  ['Apple Music', 'Catalog search and 30-second previews, no account. The full song plays from YouTube when the app finds it there.'],
  ['Your files', "The app's own player: gapless, on your PC."],
]

export const PRIVACY: [string, string][] = [
  ['Library and settings', 'Stay on this PC, in a local database.'],
  ['Sign-ins and keys', 'Stay in the Windows Credential Manager.'],
  ['Requests', "Go out through the app's core only: the interface never calls the network by itself."],
  ['Search', "What you search for goes to YouTube, YouTube Music and Apple Music, signed in or not, and to YouTube's suggestions as you type (Settings › General turns them off). Recent searches stay on this PC."],
  ['Pasted playlist links', 'A public Spotify, Deezer or Apple Music playlist or album link makes the app ask that service for the list: open.spotify.com, api.deezer.com (link.deezer.com for its short links), music.apple.com and itunes.apple.com. No account; only titles, artists, lengths and covers come back, then each song is searched on YouTube. Cover pictures load from the image hosts of those services.'],
  ['Lyrics', "When you open them: YouTube Music's timed lyrics first if you're signed in, then the song's title, artist, album and length go to LRCLIB. Answers stay on your PC."],
  ['Voice search', "Off until you allow it. While it listens, your voice goes to Microsoft through Windows' own speech recognition. The app keeps nothing."],
  ['Music Detector', 'Off until you allow it. 10 seconds of sound, from the microphone or what this PC plays, go once to AudD to name the song. Nothing is saved.'],
  ['Sync Mode', 'Off until you set it up. One file per PC in a folder you pick (OneDrive by default), sealed with your password if you set one. Over your network, a 6-digit code seals the exchange.'],
  ['YouTube embedding check', "When a YouTube song starts, its video id (and the next two) goes to YouTube's oEmbed, to learn whether its owner allows embedding. The answer is kept a day."],
  ['Updates', 'At launch, the app asks GitHub whether a newer version exists, and installs it between two songs.'],
  ['Error log', 'Errors and playback switches are noted in a small log on this PC (5 MB at most). Nothing sends it: Settings › About › Copy diagnostics puts a summary in your clipboard for a bug report, without song titles or account names unless you ask.'],
]

export const SERVICES: [string, string][] = [
  ['YouTube Music', "Sign in with Google, on Google's own page. Several accounts."],
  ['Spotify', "Your own app from the Spotify Developer Dashboard (Premium needed while it's in development mode), or paste public playlist links."],
  ['Apple Music', 'Catalog search and 30-second previews, and public playlist or album links, no account.'],
  ['Deezer', 'Paste a public playlist or album link: its songs come in and play from YouTube. No account.'],
  ['Your files', 'Add your music folders; changes in them show up as they happen.'],
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
  { q: 'Does it download music?', a: "No. Music plays in each service's own player or from your files. Nothing is downloaded, recorded or extracted." },
  { q: 'Why does Spotify need Premium and a key?', a: 'Spotify lets other apps play only through its own app, for Premium accounts, and every app needs a free key from its developer dashboard. Without them, paste a public playlist link: its songs play from YouTube when the app finds them there.' },
  { q: 'Mac or Linux?', a: 'Windows 10 and 11 only, for now.' },
  { q: 'How do updates work?', a: 'The app checks GitHub at launch and installs a new version between two songs, or while nothing plays. You get the versions that were tried first (Stable); Settings › General has a Beta channel that brings every change first, and may break.' },
  { q: 'Can I write a plugin?', a: <>Yes: a folder with a manifest and a script, which asks for its permissions when someone installs it. The guide: {link(`${GITHUB}/blob/master/docs/plugins.md`, 'docs/plugins.md')}.</> },
]
