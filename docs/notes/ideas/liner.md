# Against Liner (user's ask 2026-11-05: lead it on every point)

Liner (`tryliner/desktop`, https://tryliner.fun) read on 2026-11-05: its README, `docs/PRIVACY.md` and `docs/FAQ.md`,
its website, its release assets and its commit subjects. Never its code: its licence forbids reuse (CLAUDE.md), and
everything here is written from scratch. Its numbers move fast: check again before quoting one.

## Who they are

- Electron + TypeScript (React, Vite), first commit 2026-08-20, about 650 commits, 0.2.11 on 2026-11-01. Windows,
  macOS (x64 and arm64, unsigned) and Linux (AppImage, deb). No phone.
- 761 stars, 113 forks, 52 open issues; about 166 000 downloads of its installers, updates included (23 500 of
  0.2.11's Windows installer in 4 days). Discord, Telegram, GitHub Discussions, outside contributors, issue forms,
  CodeRabbit reviews. Website in English, Ukrainian and Russian.
- A server of theirs (`api.tryliner.fun`). An account is required: email and password, one per IP address, a
  Cloudflare check and a proof of work at sign-up. The library and playlists live there. Play events (time listened,
  skips, seeks, where from), lyrics lookups and a heartbeat every 60 s go to it. Free: 50 playlists, 1 000 liked songs.
  Liner Plus, $4 a month: bigger limits, profile cosmetics, hosting rooms.
- Playback: YouTube Music's audio fetched directly (`googlevideo.com`, with a proof-of-origin token minted in a hidden
  YouTube page), their own copies served from Cloudflare R2 first, liked songs downloaded for offline, a stream quality
  picker (Opus 160 / AAC 128 kbps), SoundCloud streams, local files copied into the app's folder.

## Side by side

| Area | Liner | Legato | Ahead |
|---|---|---|---|
| Weight | 155 MB Windows installer (Electron); RAM not published | 10.6 MB installer; 149 MB open and paused, 57 MB in the tray, window in 0.76 s (`docs/performance.md`, 2026-11-05) | Legato |
| Platforms | Windows, macOS, Linux | Windows, Android | Liner on the desktop, Legato on the phone |
| Account | Required, on their server | None | Legato |
| Limits, price | 50 playlists and 1 000 likes free; Plus $4 a month | None; free | Legato |
| Privacy | Play events, a heartbeat every 60 s, lyrics lookups to their server | No server of ours; Settings › Privacy lists the day's hosts | Legato |
| Playback | YouTube's audio taken, their own copies, downloads | YouTube's embedded player, Spotify's own, local files; nothing downloaded | Legato on the rules; Liner gets offline and a quality picker from it |
| Sources | YouTube Music, SoundCloud (search, play, sets, likes), local files | YouTube and YouTube Music, Spotify, Apple Music (import), watched local folders, SoundCloud song links | Liner on SoundCloud |
| Import | Links from Spotify, Apple Music, Deezer, SoundCloud (likes), YouTube; a step to review the matches; "in seconds" | Links, plus Connect Spotify (private playlists, Liked Songs), Connect Apple Music, Exportify, Spotify's data export, playlist files, iTunes XML; Songs not found page; 3 s between searches (Google's limits) | Legato on reach; Liner on speed and the review step |
| Lyrics | Word and syllable timing, "9 sources" with Genius behind, a source picker with a match %, an instrumental mark | Word timing (LRCLIB's Lyricsfile); the file's own, LRCLIB, YouTube Music; Karaoke; find a song by a line; timings stretched for slowed versions | Liner on sources and the picker; Legato on the rest |
| Visuals | A warped cover background (WebGL), ambient backgrounds per song from their server | Visualizer v2 (20+ looks, MilkDrop presets), pre-blurred backdrop, moving cover, accent from the cover, themes, own CSS | Legato; Liner on the moving background |
| Social | Profiles (avatar, banner, modules), friends, listening rooms (synced, reactions, 50 people with Plus), share links that open in a browser | App links, QR codes, nearby share, share as a picture, recap cards, phone remote | Liner |
| Discord | On by default, a status format choice, a "Listen on Liner" link, the artist's picture | Add-on: a status format (app, artist, song, both), the artist's picture (2026-11-06), Listen on YouTube / Spotify / Apple Music buttons, a live preview; Discord's app still named "Music App" | Even, but for the app's name |
| Player | Corner mini player opening on minimize, overlay window, full screen, 10-band EQ | Picture in picture, floating mini player, Karaoke, Cover display, full-screen visualizer, Live Editor (EQ, tempo, pitch, reverb), Auto-DJ, fades | Legato |
| Library | Likes, saved items, history, daily mixes (server), radio | Smart playlists, stats, recap, mixes, Auto-DJ, column browser, genres, bookmarks, library health, Sync Mode between PCs | Legato |
| Windows | Windows 11 snap layouts, window motion, thumbnail buttons; Touch Bar on Macs | Thumbnail buttons, Jump List, media panel, tray mode, global shortcuts; custom title bar without the snap layouts flyout | Liner on snap layouts |
| Updates | Every 15 min; front-end hotfixes without a reinstall | Installed between two songs, Beta and Stable channels, the phone's APK | Legato |
| Languages | 11 in the app, 3 on the website | 18 in the app, 1 on the website | Legato in the app, Liner on the website |
| Ours only | | Music Detector, Last.fm and ListenBrainz, SponsorBlock, plugins, alarm, sleep timer, phone remote, OBS overlay, voice search | Legato |
| Community | 761 stars, Discord, Telegram, Discussions, contributors | 3 stars, 144 downloads | Liner, by far |

## What we never copy

- **Their playback**: taking YouTube's audio, serving copies, downloading for offline (CLAUDE.md: legal playback only).
  It gives them offline and a quality picker; it also breaks with each change at YouTube (0.2.11 had to skip signed-in
  playback: "its cors breaks googlevideo sabr") and exposes them to takedowns. Our answers: local files and personal
  servers for offline, a faster start on a skip (6 below).
- **Their server**: accounts, limits, a paid plan. Legato stays free with no account; what needs a meeting point uses a
  static page (8) or a public relay the owner approves (11).
- **Their code** (licence) and the shaders they credit (Kawarp): ours are written from scratch.

## What to build, easiest first

The owner's ask (2026-11-05): all of them, in this order. Each line is also in [plan-v2.md](../plan-v2.md) › Against
Liner, with the same number. The usual extras (i18n with French, settings search, right-click menus, tests, docs and
the website) as in [README.md](README.md).

Already ours (checked 2026-11-05, so not on the list): the instrumental mark (`LyricsPanel.tsx`, `Karaoke.tsx`), the
settings search in every language (`msg` labels), an everywhere shortcut for picture in picture (`keys.ts` `pip`),
brand channels (`ytmusic.rs` page ids), recent searches (`search/recent.ts`), Discord's buttons
(`connectors/src/discord.rs`), the taskbar's thumbnail buttons (`thumbbar.rs`), issue forms (`.github/ISSUE_TEMPLATE`).

1. `S` **Keep the screen on while music plays.** A setting (off), in Settings › Playback: while a song plays, the
   screen doesn't sleep (WebView2's wake lock, as `CoverScreen.tsx` takes it); paused or stopped, it lets go. Done
   when: the lock follows play and pause, tests on the pure rule.
2. `S` **The artist's bio.** YouTube Music's artist page carries its own "About" text (the header's description): read
   it in `ytmusic` (`Artist` gets `about`), show it on the artist page, three lines and Read more. Done when: a
   recorded page in a unit test gives the text, the page shows it.
3. `S` **Discord, on par.** A status format (song, artist, both), the artist's picture as the small image, a preview in
   Settings › Add-ons. Discord's app name is the owner's step (plan-v2 › Waiting on the user).
4. `S` **The mini player on minimize.** A setting (off): minimizing opens picture in picture, restoring closes it; the
   sung line in it. YouTube's rule: the video at 200 × 200 at least, or Cover mode only.
5. `S` **Settings › Storage.** What the app keeps on this PC, with sizes: the library, covers (its limit is already
   there), lyrics and other caches in SQLite, diagnostics logs, WebView2's own cache; a Clear for what can go (covers,
   caches, logs), never the library. Liner shows its cache as a chart. Done when: sizes read by an `async fn`, Clear
   tested on a temp folder.
6. `S` **A native window on Windows 11.** Sees: hovering the maximize button shows Windows' layouts flyout, and
   minimize / maximize animate, as on a native window. How: the main window's subclass (as `src-tauri/src/thumbbar.rs`
   does) answers `WM_NCHITTEST` with `HTMAXBUTTON` over the button's rectangle (sent by the UI when it moves) and
   turns its clicks into the button's own; the animations need the caption styles kept while the frame stays ours.
   Done when: the flyout shows on Windows 11, a click still maximizes, the button keeps its hover look.
7. `S` **A profile card without an account.** Top artists, the recap and a few playlists as a picture (the recap's
   cards and Share as a picture already draw one), then as a link with 11. Liner's profiles need its server.
8. `S` **Motion polish, for the owner's eye.** The play / pause icon morphing, a like's pop, pages fading in. None with
   reduced motion (Windows' setting and ours). `docs/design.md` asks for calm: built behind a setting if the owner
   isn't sure.
9. `S-M` **Check the matches after an import.** The songs matched with a low score, their candidates side by side, pick
   one or keep it, approve all. Scores from `music_core` matching. Done when: an import with doubtful matches shows
   the step and the choices stay.
10. `S-M` **Fast start on a skip.** Measure the time to sound (the playback log), then cue the next YouTube video in the
    crossfade's second player during the last seconds, dropped if the user picks something else. Done when: the
    median time to sound on Next is lower, measured.
11. `S-M` **Share links that open in any browser.** A static page on the website (`/l#…`) reads a playlist from the
    link's fragment (a browser never sends it to a server): the songs, "Open in Legato" (`musicapp://`), "Listen on
    YouTube" per song, "Get Legato". GitHub Pages already hosts the site, so no server of ours. Covers there load from
    YouTube's image hosts in the visitor's browser: the page says so. Done when: Share › Copy link gives that address
    and the page shows a 500-song playlist.
12. `S-M` **A moving cover background.** Our own WebGL shader: the cover's colours, warped slowly, in Now Playing,
    Karaoke and the Cover display, and behind Home as an option. Quarter size, 30 fps, stopped when hidden or paused,
    off with reduced motion. Done when: a setting, and its CPU measured like the visualizer's (under 3 % of the PC).
13. `M` **Imports in seconds.** Liner says "in seconds"; ours waits 3 s between searches for Google's limits. Without a
    single extra search: the playlist is there at once with every song, a song not yet found is looked up when it
    comes up to play (one search per song played, a person's pace), the rest at `searchpace`'s slow pace in the
    background, and the import screen says how many are left. Rules: never quicker, never around a refusal. Done
    when: a 1 000-song import shows its playlist in seconds and plays its first song at once.
14. `M` **More lyrics sources and a picker.** Sees: "Lyrics: LRCLIB · 98 %" and a menu with the other candidates, the
    choice kept per song. How: `music_core::lyrics` scores candidates (title, artist, length, synced, words); new
    connectors only after their terms are read (candidates: NetEase, QQ Music and KuGou for word timings, Megalobiz,
    Genius for plain text); asked only when the first sources miss or the picker opens; cached in SQLite; a privacy
    row each (the `add-connector` skill). Done when: four sources or more in the picker, mockito tests.
15. `M` **SoundCloud sets and likes.** SoundCloud's official widget lists a set's sounds (its Widget API's
    `getSounds`): terms read first, then matched on YouTube like a pasted list. Then the SoundCloud lines already in
    plan-v2 (search, playback in the widget: the owner's call).
16. `M` **Reach.** The website in the app's 18 languages, screenshots in the README, winget and Scoop manifests, GitHub
    Discussions, "good first issue" labels. Outward steps (a PR to `winget-pkgs`, turning Discussions on, a Discord
    server) are the owner's word. Takes in plan-v2's Community line.
17. `L` **Listening rooms with friends, over the internet, without a server of ours.** A room code (sealed like Sync
    Mode's), control messages only (song, position, play / pause, reactions), sealed end to end and carried by a
    public relay (WebRTC, its signaling over public relays), or the local network. Each listener plays from their own
    source. The relay is the owner's call, as for Sharing's wormhole words; a privacy row. Takes in plan-v2's "Listen
    together on the local network".
18. `L` **A Linux build** (AppImage, deb): WebKitGTK instead of WebView2 (the shield's hook and the window scripts
    differ), the MPRIS media panel, the tray, global shortcuts (X11; Wayland's portal), PipeWire for the detector's
    loopback. No signing needed, so before macOS.
19. `L` **A macOS build**, unsigned first as Liner's (signing and notarizing: the owner's Apple Developer Program):
    WKWebView, Now Playing and the media keys, the menu bar, ScreenCaptureKit for the detector's loopback. 18 and 19
    take in plan-v2's macOS and Linux line.
