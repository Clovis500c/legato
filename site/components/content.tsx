import type { ReactNode } from 'react'

// Every line here is something the app does today (checked against the code, 2026-10-29). Privacy rows replace
// docs/privacy.md: keep them in step with what the app sends.
// The page's text is English here; copy/<code>.ts holds the app's 17 other languages in the same shape: a line changed
// here changes there too. PRIVACY stays English in every language, the one reference for what leaves the PC.

export const GITHUB = 'https://github.com/Clovis500c/legato'
/** The public Discord invitation: a link out, the visitor clicks and nothing is sent from this site. */
export const DISCORD = 'https://discord.gg/WsqAuCSxQU'
export const PLUGINS_GUIDE = `${GITHUB}/blob/master/docs/plugins.md`

export type IconName = 'Playlist' | 'Sparkle' | 'FolderSimple' | 'Devices' | 'PuzzlePiece' | 'Translate'

/** Where the window stands: x, y from the stage's middle (share of it), degrees, zoom on the fitted size. */
export type Pose = { x: number; y: number; rx: number; ry: number; zoom: number }

type Row = [string, string]

/** The page in one language. `[label]` in a text is its link; `{name}` a value filled in (`fill`). */
export type Copy = {
  /** The html lang. */
  lang: string
  title: string
  skip: string
  nav: { fixes: string; why: string; features: string; privacy: string; next: string; faq: string; docs: string; download: string; top: string; sections: string; language: string }
  hero: { lines: [string, string, string]; lead: string; download: string; free: string; version: string; android: string; works: string; spotify: string; apple: string; folders: string }
  /** real: under the demo while the visitor drives it; window, phone: under the last chapter. */
  story: { frame: string; back: string; chapters: string; upNext: string; tryIt: string; android: string; iphone: string; real: string; window: string; phone: string }
  /** CHAPTER_SCENES' text, in their order. */
  chapters: { title: string; text: string; alt: string }[]
  fixes: { title: string; intro: string; head: Row; rows: Row[] }
  why: { title: string; intro: string; items: { title: string; text: string }[]; figures: [string, string, string, string]; mb: string; s: string; note: string; measures: string }
  /** FEATURE_ICONS' text, in their order. */
  features: { title: string; intro: string; items: { title: string; text: string }[] }
  playback: { title: string; intro: string; head: Row; rows: Row[] }
  /** english: said under the intro when PRIVACY isn't in the page's language. */
  privacy: { title: string; intro: string; head: Row; english: string; services: string; rows: Row[] }
  start: { title: string; intro: string; steps: Row[] }
  next: { title: string; intro: string; head: Row; rows: Row[] }
  /** href: where an answer's `[label]` leads. */
  faq: { title: string; intro: string; items: { q: string; a: string; href?: string }[] }
  community: { title: string; text: string; join: string; discussions: string }
  footer: { community: string; legal: string; code: string; releases: string; docs: string; license: string; notices: string; font: string; marks: string }
}

export const FEATURE_ICONS: IconName[] = ['Playlist', 'Sparkle', 'FolderSimple', 'Devices', 'PuzzlePiece', 'Translate']

/** The scroll story, in order: the demo's screen (site/demo/scenes.ts) and where the window goes. Its text: Copy.chapters. */
export const CHAPTER_SCENES: { scene: string; pose: Pose; black?: boolean }[] = [
  { scene: 'library', pose: { x: 0.2, y: 0.02, rx: 3, ry: -9, zoom: 1.08 } },
  { scene: 'import', pose: { x: 0.3, y: 0.02, rx: 2, ry: -6, zoom: 1.16 } },
  { scene: 'search', pose: { x: -0.22, y: 0.03, rx: 3, ry: 11, zoom: 1.12 } },
  { scene: 'player', pose: { x: -0.36, y: 0, rx: 1, ry: 12, zoom: 1.5 } },
  { scene: 'karaoke', pose: { x: 0.17, y: 0, rx: 0, ry: -3, zoom: 1.02 } },
  { scene: 'visualizer', pose: { x: 0.17, y: 0, rx: 0, ry: 0, zoom: 1.04 }, black: true },
  { scene: 'editor', pose: { x: -0.22, y: 0, rx: 2, ry: 8, zoom: 1.16 } },
  { scene: 'themes', pose: { x: 0.16, y: 0, rx: 0, ry: -2, zoom: 1 } },
]

// Latest row of docs/performance.md (`pnpm bench`): change these with each new row (numbers without spaces: `fill`
// writes them the page's way).
export const BENCH = { date: '2026-11-05', version: '1.1.681', os: 'Windows 11', pc: 'Ryzen 5 5500, 32 GB', songs: '10000', ramPaused: '149', ramTray: '57', windowCold: '0.76', paintCold: '1.27' }

/** `{name}` → BENCH's value, numbers written the language's way. */
export function fill(text: string, lang: string): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => {
    const v = (BENCH as Record<string, string>)[k]
    if (v === undefined) return all
    return ['date', 'version', 'os', 'pc'].includes(k) ? v : Number(v).toLocaleString(lang)
  })
}

/** The page's text with the measures written in its language: at build, so the browser shows the same text. */
export const numbered = (c: Copy): Copy => ({ ...c, why: { ...c.why, items: c.why.items.map((i) => ({ ...i, text: fill(i.text, c.lang) })), note: fill(c.why.note, c.lang) } })

/** The four measures, big, with their labels. */
export function figuresOf(c: Copy): [string, string][] {
  const units = [c.why.mb, c.why.mb, c.why.s, c.why.s]
  return ['ramPaused', 'ramTray', 'windowCold', 'paintCold'].map((k, i) => [`${fill(`{${k}}`, c.lang)} ${units[i]}`, c.why.figures[i]])
}

/** `[label]` in a text → that label as a link to href. */
export function linked(text: string, href: string, className = 'text-ink underline decoration-line underline-offset-4 hover:decoration-ink'): ReactNode {
  const m = /^([^[]*)\[([^\]]+)\](.*)$/s.exec(text)
  if (!m) return text
  return (
    <>
      {m[1]}
      <a href={href} className={className}>
        {m[2]}
      </a>
      {m[3]}
    </>
  )
}

export const PRIVACY: [string, string][] = [
  ['Library and settings', 'Stay on this PC, in a local database. A backup you make in Settings › General is one file, saved where you choose; sign-ins stay out of it.'],
  ['Sign-ins and keys', 'Stay in the Windows Credential Manager.'],
  ['Requests', "Go out through the app's core only: the interface never calls the network by itself. Settings › Privacy lists every host the app and its windows talked to today, and why."],
  ['Search', "What you search for goes to YouTube, YouTube Music and Apple Music, signed in or not, and to YouTube's suggestions as you type (Settings › General turns them off). Recent searches stay on this PC."],
  ['Connect Spotify', "Only when you use it. Exportify, a free open-source tool that isn't ours, opens at exportify.app in an app window. You sign in and accept on Spotify's own page, and it reads your lists through Spotify's official access and makes a file, which the app takes in and deletes. Exportify keeps its Spotify access in that window's storage, on this PC; you can end it at spotify.com/account/apps. Only titles, artists, lengths and covers are kept, then each song is searched on YouTube. Your Liked Songs join Liked Music: signed in to YouTube Music, those not liked there yet are liked on that account at the next sync, unless it's set not to take changes in Settings › Accounts. Spotify's own direction there, Import only or Off, decides whether Connect Spotify brings anything in, and nothing is ever sent back to Spotify."],
  ['Reading Spotify\'s page', "A second way, only if you choose it: you sign in on Spotify's own page and the app reads your lists as that page shows them. Spotify's rules forbid collecting its data with a tool and allow it to close an account that does, so the app says it first."],
  ['Connect Apple Music', "Only when you use it: you sign in on Apple Music's own page (music.apple.com) in an app window, and the app reads your playlists as that page shows them. Apple's terms forbid reading its services with an automated tool, so the app says it first. Only titles, artists, albums, lengths and covers are kept, then each song is searched on YouTube; nothing is sent to Apple. Apple's session stays in that window's storage, on this PC."],
  ['Pasted playlist links', "A public Spotify, Deezer or Apple Music playlist or album link makes the app ask that service for the list: open.spotify.com, api.deezer.com (link.deezer.com for its short links), music.apple.com and itunes.apple.com. Spotify song links copied from its app make it ask open.spotify.com for each song's page, and a SoundCloud song link asks soundcloud.com's public oEmbed for that song's title and artwork. No account; only titles, artists, lengths and covers come back, then each song is searched on YouTube. Cover pictures load from the image hosts of those services."],
  ['Cast to speakers', "Off until you turn it on in Settings. Opening the box sends a search on your local network (multicast, port 1900) and asks the devices that answer for their description; playing a song makes this PC serve that one file on its private address for the speaker to fetch, behind a random link. Nothing goes to the internet; devices and addresses off your network are refused."],
  ['Lyrics', "When you open them. A file of yours that carries its own lyrics (in its tags, or an .lrc file beside it) sends nothing; a song from your music server asks that server first. Otherwise YouTube Music's timed lyrics first if you're signed in, then the song's title, artist, album and length go to LRCLIB. Clicking the lyrics' source line asks the same places for other lyrics to pick from. Answers stay on your PC. Translate lyrics (off until you turn it on in Settings): only when you press Translate and agree in the box, the song's words go to MyMemory (api.mymemory.translated.net) with the target language, nothing else; the translation is not kept."],
  ['Internet radio', "Only when you search for stations. The words you type go to Radio Browser (all.api.radio-browser.info), an open directory with no account, which answers station names and stream addresses. Nothing else is sent; the stations' own streams are separate requests, to each station's address, once you play one. While you keep no station, the page also asks the directory for the most listened ones of your country (two letters, from the interface's language, never from your address) and of up to two genres taken from your own files' tags: those two kinds of words are all that is sent. Each station's icon is a picture fetched from the address the directory gives for it (https on a public name only, through the app, kept on this PC), when the list is shown, so that site sees the request."],
  ['Podcasts', "Only with Podcasts on (off by default) and only for a feed address you type or keep. That address is asked for its list of episodes, with no account and nothing else sent; an episode you play is a request to the server the feed names, like a radio stream. With Check podcasts on (off by default), each kept feed is also read once every six hours while the app is open."],
  ['Discord sign-in', "Only with Discord sign-in on (Settings › General, off by default) and only when you press Sign in with Discord in Settings › Accounts. Discord's own page opens in your browser, you allow Legato there (the \"identify\" access: your name and id, never your e-mail or your servers), and the app asks discord.com once for that name, your picture and your banner (the pictures are then fetched from cdn.discordapp.com by the app, never by a page, and kept in its cache; they only show on your own Accounts page). The sign-in is kept in the Windows Credential Manager and sent to Discord alone; turning the setting off forgets it. While signed in, the playlists you share carry your Discord name and id in the link, shown to the person who opens it as not verified. The link is read in their browser, no server of ours sees it."],
  ['Skip non-music parts', "Off until you turn it on. For each YouTube video that plays, the first 4 characters of its id's hash (never the id) go to SponsorBlock, sponsor.ajay.app, to learn the community's marked intros, skits and outros. The answer is kept a week on this PC."],
  ['New from your artists', "Off until you turn the section on in Customize Home. Then, once a day, the names of the ten artists you play most go to MusicBrainz (musicbrainz.org), one request each, to list their albums and singles of the last two months. No account, nothing about what you played or when. Covers: only if you turn on Settings › Appearance › Covers for new releases, each release's id goes to Cover Art Archive (coverartarchive.org), which hands the picture over from archive.org; off by default."],
  ['Song credits', "Only when you choose Credits… on a song. Its title, artist and length go to MusicBrainz (musicbrainz.org) in two requests a second apart, which answers who wrote, produced and played on it. No account, nothing about what you played."],
  ['Artist links', "Only when you press Find links on an artist's page. The artist's name goes to MusicBrainz (musicbrainz.org) in two requests a second apart, which answers the links it keeps for that artist (their website, Wikipedia, Bandcamp…). They open in your browser only when you click one. If one is a Wikipedia page, Short bio asks that page (en.wikipedia.org or another language's) for its opening paragraph, once, when you click. No account, nothing about what you played."],
  ['Song info lookup', "Only when you click Look up on MusicBrainz in Edit song info: that song's title and artist go once to MusicBrainz (musicbrainz.org), which answers the albums it is on. Nothing is written into the file until you pick one and save."],
  ['Scrobbling', "Off until you connect it in Settings › Accounts. Then what plays now and each song you listened to (title, artist, album, length, when) go to Last.fm (ws.audioscrobbler.com) or ListenBrainz (api.listenbrainz.org); ListenBrainz also gets the song's ISRC and the YouTube or Spotify page it played from. With Last.fm suggestions on (off by default), the names of your three most played artists also go to Last.fm, once a day, to ask which artists are close to them. Your key or token stays in the Windows Credential Manager."],
  ['Your music server', "Only when you sign in to one in Settings › Accounts. Then the app talks to that server's address only: your sign-in, the songs it reads, plays and covers, your likes, the lyrics of a song of its that plays, and each song you listened to from it (Jellyfin also hears when a song starts and stops), unless its direction is Import only or Off. Nothing goes to us. A Subsonic server gets a fresh token made from your password for each request, never the password itself, unless it refuses tokens (some LDAP setups): then, only after a warning you confirm and only over https://, it gets the password itself, hex-encoded; Jellyfin gets your password once, at sign-in, and an access key after that, which Sign out ends. Its password or key stays in the Windows Credential Manager, and travels to your other PCs only inside a Sync Mode file sealed with your password. Plain http:// is fine on your own network; to a public address the app warns you that it travels unencrypted."],
  ['Plex', "Only when you sign in with Plex. You sign in on Plex's own page, app.plex.tv, in your browser: the app never sees your password. The app asks plex.tv for a sign-in code and reads it until you've signed in, then asks plex.tv for your servers and their addresses (with an id made for this sign-in, the app's name and version, and your system's name: Windows or Android). After that it talks to your server only, at its address on your network or its plex.direct one, or through Plex's relay when nothing else answers (the app says so): the songs it reads, plays and covers, your likes as 5-star ratings, and each song you listened to from it, unless its direction is Import only or Off. Plain http:// is used on your own network only. Only your server's access key is kept, in the Windows Credential Manager, and it travels to your other PCs only inside a Sync Mode file sealed with your password. Sign out forgets it here; Plex lists Legato among your account's authorized devices until you remove it there."],
  ['Voice search', "Off until you allow it. While it listens, your voice goes to Microsoft through Windows' own speech recognition. The app keeps nothing."],
  ['Music Detector', 'Off until you allow it. 10 seconds of sound, from the microphone or what this PC plays, go once to AudD to name the song. Nothing is saved. Two free steps come first, each off until you turn it on in Settings: on "This PC", what the playing apps say they play (the Windows media session: title, artist and album, no sound, nothing sent); then a fingerprint of the clip, made on this PC, looked up at acoustid.org and musicbrainz.org (only the fingerprint is sent, never the sound).'],
  ['Sync Mode', 'Off until you set it up. One file per PC in a folder you pick (OneDrive by default), sealed with your password if you set one. It carries your library, settings and the song you played last with where it stopped, so another PC can pick up from there. Over your network (off until you turn it on), this device tells your others on the same network its name and kind, they pair once with a 6-digit code or a QR code, and every exchange is sealed; nothing goes through the internet.'],
  ['Listening rooms', "Only when you start or join one. A room tells the devices on the same network that it exists (its name, the host device's name, how many listen), and only devices with its 6-digit code or QR code get in. Then the song that plays (title, artist, album, length, its ISRC and YouTube or Spotify id, a web cover), where it is, the next three songs, the names of the devices in the room and the reactions go to them, sealed with the code. No sound is sent, nothing goes through the internet, and the room ends when you end it or close the app. A listener plays each song from their own library or source; one not found there may be searched once on YouTube."],
  ['Phone remote', "Off until you turn it on in Settings › Playback. Then this PC answers, on its own network only, the phones that have its link (a secret in its QR code): what plays, its cover and what's next go to them, and their taps come back. Nothing goes through the internet, and a new link ends the old one."],
  ['Streaming overlay', "Off until you turn it on in Settings › Playback. Then a page for OBS on this PC shows what plays and its cover, and the visualizer's bars if you turn them on (measured only while the page is shown); only this PC is answered."],
  ['YouTube embedding check', "When a YouTube song starts, its video id (and the next two) goes to YouTube's oEmbed, to learn whether its owner allows embedding. The answer is kept a day."],
  ['Updates', "At launch and every 6 hours, the app asks GitHub whether a newer version exists. On Windows it installs it between two songs; on Android it downloads the new APK from GitHub only when you tap Update, and Android's installer asks you first."],
  ['Error log', 'Errors and playback switches are noted in a small log on this PC (5 MB at most). Nothing sends it: Settings › About › Copy diagnostics puts a summary in your clipboard for a bug report, without song titles or account names unless you ask.'],
]

export const en: Copy = {
  lang: 'en',
  title: 'Legato',
  skip: 'Skip to content',
  nav: { fixes: 'What it fixes', why: 'Why Legato', features: 'Features', privacy: 'Privacy', next: 'Next', faq: 'FAQ', docs: 'Docs', download: 'Download', top: 'Legato, top of the page', sections: 'Sections', language: 'Language' },
  hero: {
    lines: ['Your music lives', 'in four apps.', 'Play it from one.'],
    lead: 'Legato puts YouTube Music, Spotify, Apple Music and the files on your PC into one library and one player, on Windows, with no account of ours.',
    download: 'Download for Windows',
    free: 'Free · Windows 10 and 11',
    version: 'Version {version}',
    android: 'Android beta',
    works: 'Works with',
    spotify: 'Spotify (Premium, your app key)',
    apple: 'Apple Music (catalog, previews)',
    folders: 'Your folders',
  },
  story: { frame: "Legato's interface", back: 'Back to the page', chapters: 'Chapters', upNext: 'Up next: {title}', tryIt: 'Try it here', android: 'Get the Android app', iphone: 'No iPhone app yet: [the FAQ says more].', real: "Legato's real interface, with invented songs and no sound.", window: 'That window is the real interface, with invented songs and no sound.', phone: 'That phone is the real interface, with invented songs and no sound.' },
  chapters: [
    { title: 'One library', text: 'The same song on several services is one track, wherever you saved it. Browse it by artist and album in two panes, as in MusicBee.', alt: "Legato's Songs page: your playlists on the left, one list of songs from every source, Up next on the right." },
    { title: 'Your Spotify lists come over', text: 'Songs land one by one, every list counted. Each is then searched on YouTube, and the ones without a match are kept for later.', alt: 'The import screen: covers landing one by one, the list being read and the songs left.' },
    { title: 'One search', text: 'Your library, YouTube Music, YouTube and Apple Music, in one place, your best match first and a typo forgiven. Ctrl+K finds the app’s pages, actions and settings too.', alt: 'Search results for one word: a top result, songs and videos, each with where it comes from.' },
    { title: 'One queue', text: 'Every source in one list, with crossfade that leaves albums whole and a shuffle that spreads artists. What you add plays next, in its own block, and comes back after a restart.', alt: 'Now Playing: a big cover, the song, its lyrics and the one that plays next.' },
    { title: 'Press K for Karaoke', text: 'Timed lyrics, line by line, in a panel beside any page, big in Now Playing, or full screen like here.', alt: 'Karaoke mode: big lyrics on a blurred cover, the line playing lit as a whole.' },
    { title: 'Press V, lights off', text: 'LED bars, a ring around the cover, VU needles, a spectrogram, MilkDrop-style presets, full screen.', alt: 'The visualizer full screen: columns of LED bars on a dark page.' },
    { title: 'Change a song as it plays', text: 'Speed, pitch, a 10-band EQ, reverb and 3D sound, in the Live Editor.', alt: "The Live Editor beside a big cover: the song's versions, presets, speed and pitch." },
    { title: 'Make it look like yours', text: 'Colors, fonts, a picture or video background, your own CSS.', alt: "Legato's Songs page in another theme." },
  ],
  fixes: {
    title: 'What listeners keep asking the big apps for',
    intro: "Collected from Spotify's community forum, YouTube Music reviews and press coverage of their redesigns. Each line is something Legato does today.",
    head: ['The complaint', 'In Legato'],
    rows: [
      ['Fewer songs on screen after each redesign', 'A compact list by default: 40 px rows, artist and album in their own columns, the columns you pick.'],
      ['Queued songs land at the end', 'What you add plays next, in its own block above the rest of the queue, and comes back after a restart.'],
      ['No light mode, after years of asking', 'Light and dark, both designed, following Windows unless you pick one.'],
      ['The like button was taken away', "A heart on every row and in the player, one click. Signed in to YouTube Music, it's a real like there."],
      ['Lyrics hidden behind a tab', 'Timed lyrics beside any page, from YouTube Music or LRCLIB.'],
    ],
  },
  why: {
    title: 'Why Legato',
    intro: 'Four things you can check for yourself.',
    items: [
      { title: 'Legal', text: "Songs play in the official players: YouTube's own, the Spotify app, and your files and your own music server's songs in Legato's own. No platform's audio is downloaded, recorded or extracted. The Music Detector listens only when you ask, and Apple's previews are Apple's own 30 s clips." },
      { title: 'Light', text: '{ramPaused} MB of RAM with the app open and paused, {ramTray} MB after 10 minutes in the tray, silent. On a cold start the window shows in {windowCold} s and the first screen is painted at {paintCold} s.' },
      { title: 'Your PCs in sync', text: 'Sync Mode keeps your library on every PC through a OneDrive folder or your own network. No account of ours, no server.' },
      { title: 'Your scrobbles', text: 'What you play, from any source, goes to your Last.fm profile with your own free API key, or to ListenBrainz with your token. Off until you connect one.' },
    ],
    figures: ['of RAM, open and paused', 'after 10 minutes in the tray', 'to the window, cold start', 'to the first screen, cold start'],
    mb: 'MB',
    s: 's',
    note: 'Measured {date} on {os} ({pc}), Legato {version}, a library of {songs} songs. RAM is the app and its WebView2 processes together. Other apps were running during the measure, so another PC will differ.',
    measures: 'All the measures',
  },
  features: {
    title: 'Also in the app',
    intro: 'The rest, in a line each.',
    items: [
      { title: 'Playlists', text: 'Import from a service, a file (M3U, XSPF, CSV) or iTunes and MusicBee; create, pin, sort into folders, save as a file, export to YouTube Music, share by link or QR code. Smart playlists fill themselves from your plays and star ratings.' },
      { title: 'Mixes, radios and an Auto-DJ', text: 'Daily mixes, mixes for this time of day and this weekday, endless radios from a song, an album, an artist or a playlist, and an Auto-DJ that keeps your library playing by your rules. All made on your PC, with stats from what you play, a recap of your year or month to share as pictures, and Last.fm or ListenBrainz scrobbling if you want it.' },
      { title: 'Your own files', text: 'Gapless playback, as loud as your streamed songs (their ReplayGain tags, or measured), and their tags to edit, a whole album at once: artist, album, genre, year, track numbers, cover. Their own lyrics come first: edit them, or time plain ones by tapping along. Your own music server (Jellyfin, Plex, Navidrome or another Subsonic one) streams into the same player.' },
      { title: 'Sync Mode and listening rooms', text: 'Your library on all your PCs, through a OneDrive folder or your network. Start a room and friends on the same Wi-Fi follow what plays, each from their own source, with reactions.' },
      { title: 'Add-ons and plugins', text: 'Plugins by others ask for what they need before they can do anything.' },
      { title: '18 languages', text: 'Following Windows, with its media keys, a tray icon, a Jump List, an alarm, picture-in-picture and full screen. The music pauses when your headphones disconnect, or when a call starts if you want, and your phone can be the remote.' },
    ],
  },
  playback: {
    title: 'Official playback only',
    intro: "Each service plays in its own player, your files in the app's. No platform's audio is downloaded, recorded or extracted (the Music Detector listens only when you ask it to); the sound features work on what plays, as it plays, in memory.",
    head: ['Source', 'How it plays'],
    rows: [
      ['YouTube Music and YouTube', "In YouTube's own player, its video in view: in the right panel, or big in Now Playing."],
      ['Spotify', 'Through the Spotify app (Spotify Connect), with Premium and your own app key. Without either, public playlist links and Connect Spotify bring your lists in, and their songs play from YouTube.'],
      ['Apple Music', 'Catalog search and 30-second previews, no account. The full song plays from YouTube when the app finds it there. Connect Apple Music brings your own playlists in.'],
      ['Your files', "The app's own player: gapless, on your PC."],
      ['Your music server', "The same player, streamed from your Jellyfin, Plex, Navidrome, Airsonic, Gonic or Ampache server: gapless, seekable, with the Live Editor's effects. A format the app can't read comes as your server's own MP3 (Jellyfin and Subsonic servers)."],
    ],
  },
  privacy: {
    title: 'What leaves your PC',
    intro: 'Nothing, until you connect a service or turn a feature on. No server, no account of ours.',
    head: ['What', 'Where it goes'],
    english: '',
    services: 'Connecting services',
    rows: [
      ['YouTube Music', "Sign in with Google, on Google's own page. Several accounts."],
      ['Spotify', "Your own app from the Spotify Developer Dashboard (Premium needed while it's in development mode), or Add music › Connect Spotify or Spotify's own data export, or paste public playlist links."],
      ['Apple Music', 'Catalog search and 30-second previews, and public playlist or album links, no account. For your own playlists: Add music › Connect Apple Music.'],
      ['Deezer', 'Paste a public playlist or album link: its songs come in and play from YouTube. No account.'],
      ['SoundCloud', "Paste a song's link: it comes in and plays from YouTube. No account; SoundCloud shares a playlist's songs only with registered apps."],
      ['Your music server', "Jellyfin, Plex, or Navidrome, Airsonic, Gonic, Ampache and other Subsonic-compatible servers, in Settings › Accounts: a Subsonic or Jellyfin server's address, your user and password; Plex with Sign in with Plex, on Plex's own page. Its songs, albums and playlists join your library and play in the app."],
      ['Your files', 'Add your music folders, or drop folders and songs from Explorer onto the window; changes in them show up as they happen.'],
      ['Other apps', "Playlist files (M3U, XSPF, CSV) and iTunes' or MusicBee's library file: songs on your PC come as they are, the others play from YouTube."],
    ],
  },
  start: {
    title: 'Get started',
    intro: 'About a minute, then your music is in one place.',
    steps: [
      ['Download', 'Run the installer, on Windows 10 or 11. New versions install themselves between two songs.'],
      ['Connect what you use', 'Settings › Accounts: YouTube Music, Spotify, Apple Music and your music folders.'],
      ['Play', 'Search once, queue from anywhere, keep your library on every PC.'],
    ],
  },
  // Unlike every other list here, what isn't out yet: docs/notes/plan-v2.md › Roadmap, in its order, minus what shipped.
  next: {
    title: "What's next",
    intro: "In this order, one release each, on the Beta channel first. No dates: each comes when it's ready. Missing something? [Suggest it].",
    head: ['Coming', 'What it brings'],
    rows: [
      ['Lyrics', 'A translation under each line, and a song found from a line you remember.'],
      ['Your own music', 'Your server in the search.'],
      ['Smarter listening', 'Your songs analysed on your PC (tempo, energy, key) for radios and fades that fit, a path from one artist to another, a yearly recap to share.'],
      ['Around the house', 'Speakers and TVs (DLNA, Chromecast), listening together over the internet, picking up on your other PC where you stopped.'],
      ['Windows polish', 'A picture-in-picture player.'],
      ['Phones, Mac and Linux', 'A mobile version, Android first, on the same Rust core; builds for macOS and Linux.'],
    ],
  },
  faq: {
    title: 'Questions',
    intro: 'Something else? Ask in the [GitHub issues].',
    items: [
      { q: 'Is it free?', a: 'Yes. The code is on GitHub, source-available: free to use, not open source. Issues and pull requests are welcome.' },
      { q: 'Do I need an account?', a: 'Not one of ours. You sign in to the services you already use, on their own pages.' },
      { q: 'Does it download music?', a: "No. Music plays in each service's own player or from your files. No platform's audio is downloaded, recorded or extracted; only the Music Detector listens, when you ask it to." },
      { q: 'Why does Spotify need Premium and a key?', a: 'Spotify lets other apps play only through its own app, for Premium accounts, and every app needs a free key from its developer dashboard. Without them, paste a public playlist link, or use Connect Spotify in Add music for your private lists and Liked Songs (read what it says first: the rules of Spotify forbid it): the songs play from YouTube when the app finds them there.' },
      { q: 'Mac or Linux?', a: 'Windows 10 and 11 only, for now.' },
      { q: 'Is there an Android version?', a: "A beta, yes: an APK on the download link under the Windows button (Android 8 or later, 64-bit). Open the file on your phone and allow installs from your browser when Android asks; there is no store listing: the app offers each new version itself (tap Update, then confirm in Android's installer; the first time, Android asks you to allow Legato to install apps). It talks to the same places as the Windows app, keeps its data on the phone, and syncs with your PCs over Wi-Fi from Settings › Sync Mode. iPhone: not yet." },
      { q: 'How do I move to a new PC?', a: 'Sync Mode keeps several PCs alike. For a one-time move: Settings › General › Back up your library, then Restore a backup on the new PC, and sign in to your accounts again.' },
      { q: 'How do updates work?', a: 'The app checks GitHub at launch and installs a new version between two songs, or while nothing plays. You get the versions that were tried first (Stable); Settings › General has a Beta channel that brings every change first, and may break. On Android, the app follows Beta and downloads a new version only when you tap Update.' },
      { q: 'Can I write a plugin?', a: 'Yes: a folder with a manifest and a script, which asks for its permissions when someone installs it. The guide: [docs/plugins.md].', href: PLUGINS_GUIDE },
      { q: 'Windows warns me about the installer: is it safe?', a: 'The installer isn’t signed with a Windows code-signing certificate, so SmartScreen may warn the first time: More info › Run anyway. Updates are signed, and the app checks them before it installs them.' },
      { q: 'Which file do I download?', a: 'Legato_…_x64-setup.exe: run it. The .msi is the same app, for managed PCs. New versions install themselves between two songs; Settings › General › Updates picks Stable (tried) or Beta (every green change, sooner and rougher).' },
    ],
  },
  community: { title: 'Join the community', text: 'Questions, ideas, help and news from other listeners and from the author, on Discord.', join: 'Join the Discord', discussions: 'GitHub Discussions' },
  footer: { community: 'Community', legal: 'Legal', code: 'Source-available. Free to use. Code on [GitHub].', releases: 'Releases', docs: 'Docs for developers', license: 'License', notices: 'Third-party licenses', font: 'Font license', marks: 'Spotify, YouTube and Apple Music are trademarks of their owners.' },
}
