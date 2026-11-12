# Legato: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign, the product pass, roadmap milestones 0 to 2, the user's choices along the
way) is in git: `git log -p docs/notes/plan-v2.md`, and in the release notes.

Stable: v1.1.681 (2026-11-05). Next: the lines the owner chose on 2026-11-07 (their answers: Waiting on the user),
then milestone 3, Platforms; Against Liner 6 with the owner at the PC. Where the work stands: [handoff.md](handoff.md).

Every idea here stays: the user wants them all built in the end, just later (user's choice 2026-10-31). The roadmap sets
the order; a line leaves only when it ships or the user drops it.

## The owner's asks of 2026-11-07, evening

- [ ] `S` Android: scanning a sync QR code crashes the app right after the camera permission is accepted (Beta
      1.1.785 on their phone; the diagnostics show three restarts in a minute and no error line: a native crash). 2026-11-07: the plugin's Kotlin (tauri-plugin-barcode-scanner
      2.5.3) shows no sure cause; a Java crash now lands in the diagnostics (`MainActivity.kt` `keepCrashes`, never built
      here: no Android toolchain on this PC), so the next Beta's Copy diagnostics names it. Faster: the phone on USB with
      debugging on, `adb logcat -b crash -d` on a PC with the SDK.
- [x] `S-M` Settings › Visualizer style: a dropdown instead of the 16 pills, each style shown with a preview of its look.
      2026-11-08: `LookPicker.tsx`, still previews by the visualizer's own painter (`VizThumb.tsx`, an invented sound).
      Checked in the site demo only (1400 px dark, 375 px light): not in the installed app, WebView2 or on a phone.
- [x] `M` The big title screen (the song's huge title over the backdrop, the artists under it): each artist's round
      profile picture right of their name, good-looking, several artists handled.
      2026-11-11: `ArtistLine.tsx`, each artist its own link to their page, the picture (32 px) once known. Decided
      alone (2026-11-11): no new lookup rule, Discord's (`discord_artist_art`: the artist page's kept picture, else
      YouTube Music asked for a song YouTube plays, 10 s in, one a minute), so a featured artist's picture can come a
      song later; no setting. Never seen on a screen (the preview server was declined in the unattended run): tests
      and types only. To judge: the size, the gap, a name cut by `allArtists` at a comma ("Tyler, The Creator").
      The owner's choice 2026-11-11: one search per artist, cached, refreshed when the song changes (open line below).
- [x] `M` Up next: a better-looking list, redone the way the lyrics were (on the backdrop, Against Liner U2's glow and
      simplicity).
      2026-11-11: Now Playing's panel only (`UpNext`'s `bare`; the main window's side panel keeps its card): no card,
      the list's edges fading, covers lifted by a shadow, the playing song by its bigger title and its mark's glow
      instead of a grey box. Decided alone (2026-11-11): a light pass, rows and their size kept (drag, the virtual
      list), easy to push further once seen. Never seen on a screen: types, lint and Vitest only (no Rust touched,
      so no cargo run for this commit).

## The owner's answers of 2026-11-11 (still to build)
Also settled: no push yet (they try with `pnpm dev` first); the flowing background, the new-releases section and the
classic mini player stay off by default; the web share link stays the default; permissions ahead for the next runs: yes.
- [x] `M` Artist pictures: one lookup per artist (not one a minute), kept in a cache, refreshed when the song changes
      (the owner's choice 2026-11-11). Replaces the Discord rule used by the big title's round pictures.
      2026-11-11: `artist_picture` (replaces `discord_artist_art` for the big title; Discord's keeps its one-a-minute rule):
      the kept artist page's picture, else YouTube Music asked once per artist, one at a time (an async mutex), none during an
      import or 15 minutes after a refusal, a miss not asked again for 6 hours (`searchpace::Looked`); still only for a song
      YouTube plays, 10 s in (a local file's artist is not sent). "Refreshed when the song changes" = the next song's new
      artists are asked at once; a kept page follows the cache's own expiry. Untried against the real YouTube Music.
- [x] `S` Flowing background behind Home, as a setting, off by default (the owner's choice 2026-11-11).
      2026-11-11: Settings › Appearance › Flowing background behind Home (`homeFlow`, off; needs Animations): `HomeFlow` in
      `HomeView` draws `Backdrop` (moved to `player/Backdrop.tsx`, a `flowing` prop) with `bc90071`'s shader, which pauses with
      the song and a hidden window; dimmed at 72 % to read the cards. Never seen on a screen: the dim and the stacking
      (`isolate` wrapper around Home) are unjudged.
- [x] `S` `legato://` registered with Windows from the installed app only (`identity::installed()`), for a real
      "Open in Legato" button on the share page, AND the page's "Copy the link for Legato" kept (the owner's choice
      2026-11-11; the web link stays the default).
- [x] `S` Cover Art Archive covers for "New from your artists", as an option off by default, with its website privacy
      row (one more host; the owner's choice 2026-11-11).
- [x] `S` The classic mini player keeps its place after a restart (a setting; `pipMode.ts` keeps it for the run only,
      checked in the code: `classicPlace` is a module variable, `f5528ba` does not save it).
      2026-11-11: `f5528ba` kept it for the run only; now settings `pipClassicPlace` (per PC, in `LOCAL_SETTINGS`, saved on
      close like `pipPlace`, refit to a screen by `pip.rs`). Never seen on a screen: Vitest on the sanitizer only.
      2026-11-11: Settings › Appearance › Covers for new releases (`releaseCovers`, off); on, a card's cover is
      `coverartarchive.org/release-group/<id>/front-250` through the `art` scheme (allowlist: that path, then archive.org's
      `/mbid-` files it redirects to), the website's "New from your artists" row says so; Settings › Privacy lists the hosts
      on its own (`Noted`). A release group without a cover shows the letter cover. Untried against the real archive:
      the redirect's hosts and file names are from its docs / memory, mock-free (the allowlist is tested on shapes only).
      2026-11-11: `src-tauri/src/protocol.rs`: the installed release app writes HKCU\Software\Classes\legato at launch
      (no admin; a command naming a gone exe is replaced, a working other one left), the NSIS uninstall hook removes it. A
      launch's `legato://` argument (this one or a second, single instance) waits in Rust; `startOpenedLinks` takes it, keeps
      it only if `isShareCode` (a pasted link's test) and opens the same import dialog. The share page has "Open in
      Legato" beside "Copy the link for Legato". Untried: the registry write, Windows starting the exe with the link, the
      uninstall hook, a browser's "open this app?" prompt (needs the installed app: a dev build never registers).
- [x] `S-M` Explicit songs hidden everywhere (own playlists, album, artist and search pages), only hidden: a way for
      the user to bring one back when the flag is wrong (the owner's choice 2026-11-11).

## The owner's asks of 2026-11-11, night

Noted from their message, nothing built or checked yet. After the answers above, or later, by the plan's priorities.
Where a line says "reading", the owner hasn't confirmed it.

- [x] `S` FIRST (the owner's word): a song can't be removed from a playlist from the player. Seen in Now Playing's
      right-click menu while playing from a playlist ("Lecture depuis Music"): Add to a playlist lists the
      playlists, nothing removes. Reading of the fix: "Remove from {playlist}" for the playlist it plays from, and a
      check on each playlist that already holds the song, a click on it removing it; the same in every menu of a
      playing song (player bar, Up next, mini player). Find the cause first: other lists have Remove from playlist.
      2026-11-11: cause: `playerMenu` (Now Playing, player bar, mini player, side panel) offered `addTo` but never
      `removeFrom`, and "Add to playlist" didn't know which playlists held the song. Now one song's "Add to playlist"
      checks the own playlists holding it (a click removes, with Undo), in `trackMenu` too (Up next, rows), and the player's
      menu has "Remove from {playlist}" for the playlist the queue plays from (`library/holding.ts`, matched by the name the
      queue keeps). Not done: YouTube Music / server playlists in that check (they stay in "Remove from ›"). Never seen on a
      screen: Vitest on the helpers only (`menus.tsx` can't be imported by a test: it touches `window`).
- [x] `S-M` Bug, second in priority (the owner's report, 2026-11-11 night, Beta 1.1.807, YouTube signed in, crossfade 2 s,
      autoplay on, liveYoutube on): the same song played twice at the same time. The only clue in their diagnostics, at
      the moment it happened: `playback youtube: the embed refused the video, playing it from its watch page`, then 0.6 s
      later a normal `time to sound, after a song` line. No other error line. Lead to check first: the refused embed (or
      the crossfade's other player) still starts or is never stopped once the watch page takes over, so both sound.
      2026-11-12, cause in the code: the store opens the watch page (and pauses the embed) as it sets the song, then
      React hands the embed that video with `loadVideoById` (in a crossfade, a new embed with autoplay, the pause sent
      to no frame); a video blocked after a stall plays fine there. Fixed: the embed only cues a video its watch page
      plays (`embedStarts`), and one that starts anyway is paused. Not tried for real (needs a refused video).
      2026-11-11: with the setting on, hidden in Songs, every playlist (own ones too: while some are hidden the playlist is
      not editable by position, like with a search typed), albums, artist pages, search, mixes, and radios / autoplay
      (`similarTo`); each list that is shortened shows "N explicit songs hidden · Show" (`HiddenExplicit`) whose rows
      have "Not explicit" (also in the song menu of a flagged song, with Undo). The word is kept in the library (`explicit`
      = 2, a source saying explicit again can't undo it; `Library::set_explicit_ok`, no schema change). Not covered: Home's
      shelves and cards, the Up next queue already built, a playlist's play-all from a sidebar menu (they use the same
      lists, but only the pages above were filtered). Never seen on a screen.
- [x] `S-M` The share page (`/l`, since `867cc53`) as a good-looking preview of a playlist without the app, from the
      compact links: a preview only, no player on the web (the owner's word).
      2026-11-11: the page has a header card in a colour drawn from the playlist's name (`hueOf`), its songs, known time and
      where they play (`summary`, from the link alone), numbered tiles in the same colours, "Open in Legato" first. Still no
      covers (they would load from YouTube's host for the visitor) and no player. Never seen in a browser: `next build` and
      Vitest only; the colours' contrast on the light theme is unjudged.
- [ ] `M` Remixes shared outside the app: a small file of ours, `.lmix` (or close, the owner's call), and its compact
      link. It holds the song's YouTube link and the mix's Live Editor presets, never the audio (no mp3: Fixed
      limits, no download). Dropped on Legato, the song plays with the Live Editor open on those presets.
      A mix of a local file is the one case where the file carries audio (the owner's word, 2026-11-11): the mp3
      itself, or a version encoded for the `.lmix`. Only for the user's own local files, never a platform's audio
      (YouTube, Spotify, Apple Music: the link only). File only, too big for a compact link. To settle before
      building: a note at export that sharing a song is the user's responsibility (their own music or rights), a
      size limit, whether a personal server's song counts as local, and the embedded audio treated as untrusted
      when opened (the Security line).
      2026-11-11, the YouTube-link form: `.lmix` (JSON: format, version, name, video id, title, artist, the Live Editor's
      `Effects`) in `music_dsp::lmix` (64 KB, unknown fields refused, the settings clamped, tested with a fuzz loop);
      `lmix_read` / `lmix_write` in the shell; dropping one on the window plays the song and opens the editor on its settings
      (`features/editor/remixFile.ts`); Live Editor's menu has "Share this mix as a file…" (a YouTube song only). Left open:
      the Windows file type (double-click on a .lmix), the local-file form that carries audio (the owner's answers first).
      2026-11-12, the compact link: `legato://remix/<base64url of the settings that differ from neutral>` (about 280
      characters), copied from the Live Editor's menu ("Copy this mix's link"), pasted anywhere or opened from the system, checked
      like a file (`lmix::from_link`, fuzzed). Decided alone (2026-11-12): the link carries no audio and no new host. Untried: a real drop, the editor's load race on a slow start (waits 5 s), the YouTube thumbnail as art.
- [ ] `M` Optional sign-in with Discord, for a profile (the owner will make a Discord bot anyway). Never required.
      First use: the share page shows who shared a playlist, their profile carried in the link so it can't be faked
      (the owner's word: encrypted in the link). Open before building: encryption alone doesn't stop a fake, a
      signature does, and a signing key shipped in the app can be taken out of it; a signature by the owner's bot
      is a server of ours (CLAUDE.md: serverless). The owner's call between an unverified profile, or their bot
      signing as an exception to that rule. Discord's OAuth for a desktop app without a secret: to check; a new
      host, so a privacy row.
- [x] `M` Drag and drop of every file type that is Legato's own into the app: the remix file, and the others (list
      them first: shared playlists, backups, themes, playlist files; a plugin folder never installs without its
      permission review). Today a drop takes folders, songs and a QR picture.
      2026-11-12: listed: the remix (`.lmix`), a backup (`.legato`), a theme (`.theme`), a song list (`.m3u`, `.m3u8`, `.xspf`,
      `.csv`, `.tsv`, `.txt`). Dropped, each opens as its page opens it (`library/dropKinds.ts` picks by type, `dropFiles.ts`):
      a list becomes a playlist, a theme joins the themes and is picked, a backup asks before replacing the library; Rust
      checks size and shape as before. Not dropped on purpose: a plugin folder (it is read as a music folder; plugins install
      only through their review), `.musicsync` files, share-code text files. Never tried with a real drop.
- [x] `M` Share as a picture, dropped on the app, brings its music back: from the picture's metadata first, and from
      the picture itself when the metadata is gone (Discord strips it): a code the app can read in the pixels (the QR
      path exists: check what the card carries today).
      2026-11-11: the card carried no code. Now ("Share as a picture", a toggle "Code to bring the song back", on): a small QR of the
      song (`song_code`: the YouTube id alone, else the names) in the card's bottom right corner, and the song's web link hidden in the
      saved PNG as a `tEXt` chunk "Legato" (`core::pngmeta`; a JPEG keeps the QR only). Dropped on the app, `read_picture` reads
      the chunk first (only text that parses as a share counts), else the QR in the pixels; tested end to end on a drawn card
      in both forms. Not done: the stats recap cards carry no code, the card from the web page. Untried: the QR's look and size
      on the real card (190 px, bottom right, unjudged), a card through Discord's own re-encoding.
- [ ] `M-L` Security, the drop first, before the remix file and the picture lines above (agreed 2026-11-11): every dropped or opened file is untrusted (size limits, strict parsers, no path
      taken from a file, nothing run, fuzz or property tests on each parser). Then a security pass of the whole app
      (IPC commands, deep links, the `art` scheme, the CSP, plugins, the phone remote and the overlay), findings fixed
      with tests.
      2026-11-11, the drop's half: `crates/core/src/fuzz.rs` hammers each parser a dropped or opened file reaches (share codes and
      links, theme files, M3U / XSPF / CSV lists, song lists, iTunes XML, lyrics files, Sync Mode files, audio tags, QR pictures)
      with thousands of damaged inputs (fixed seed, no new dependency): none panics, outputs stay bounded, a path in a playlist
      file only ever finds a song the library already holds, a plain sync file brings no secrets. Fixed on the way: a dropped
      QR picture had no size or dimension limit (`share::read_qr`: 25 MB, 12 000 px a side, 256 MB), Exportify's file was read
      whole before its size was checked. Not covered: `cargo-fuzz` depth (decoders of lofty / symphonia / image are theirs),
      backups and plugin folders (not dropped), the whole-app pass (still open, for Opus).
- [ ] `L` The website made beautiful (the owner: too basic today) and given documentation sections for developers
      (plugins' API, themes, the link and file formats, contributing). The design is a piece Fable may do itself (the
      owner's word).

## The owner's asks of 2026-11-12

- [x] `S` Next on the last song of the queue did nothing (it marked the player paused while the sound went on). 2026-11-12:
      with Repeat off it now stops and waits at the song's start, like Stop; with Repeat all it already went back to the
      first song (unchanged). Decided alone (2026-11-12): stop rather than ask the autoplay for similar songs on a manual
      Next (the autoplay setting still decides when a song ends by itself); easy to change in `store.ts` `step`. Not tried
      on a screen: Vitest only (the sound itself is the engine's).

## Best in class (user's ask 2026-10-30)

What a listener would get, against Riff (rootscripts/riff: Electron, yt-dlp downloads, YouTube / SoundCloud, imports
from Spotify / Apple / Deezer) and the best players overall (Spotify, Apple Music, MusicBee, Plexamp, foobar2000,
Cider). Already ours and kept as selling points: legal playback (no downloads), Tauri (light), Sync Mode between PCs,
Last.fm, Music Detector, Live Editor (10-band EQ, tempo, pitch, reverb, space), smart playlists, stats, mixes, sleep
timer, synced lyrics with offset, visualizer, themes + own CSS, plugins, Windows media panel, global shortcuts, many
languages. Rules unchanged: nothing on this list downloads, records or exports a platform's audio, and no server of ours.

Each line below is detailed (what the user sees, how, rules, effort, done when) in [ideas/](ideas/README.md).

### Roadmap (order to build in; effort S = one session, M = a few, L = many)

Pick from the top. Each milestone is one release on the Stable channel; workflow items that unblock others go first, and
a quick win from Features › High can go in any release. Milestones 0 (Groundwork), 1 (First impression) and 2 (Sound and
sight) shipped together as Stable 1.1.

| # | Milestone | What lands | Effort | Why now |
|---|---|---|---|---|
| 3 | Platforms (1.2) | Spotify private playlists and Liked Songs for free (Connect Spotify, guided copy, data export), SoundCloud links, playlists as files, import from other apps | M | The user's ask; a library that can't move is the first reason not to switch |
| 4 | Lyrics (1.3) | Word-by-word lyrics, translation, find by a line, lyrics saved into files and tapped live | M | Riff and Cider's most loved screen |
| 5 | Your own music (1.4) | ~~Jellyfin / Navidrome / Subsonic / Plex~~ (done 2026-11-06), ReplayGain, batch tag editor + MusicBrainz, ratings, column view, ListenBrainz, playlist folders | L | MusicBee / foobar / Plexamp users switch for this |
| 6 | Smart (1.5) | Local sonic analysis, song / artist radio, sweet fades, path between artists, auto-DJ, smart shuffle, Wrapped | L | What no free desktop app does without a server |
| 7 | Around the house (1.6) | ~~Phone remote~~ (done 2026-11-02), cast (DLNA / Chromecast), ~~listen together on the LAN~~ (done 2026-11-06), pick up on the other PC | L | Turns a player into a home system |
| 8 | Windows polish (1.7) | Command palette, taskbar buttons + Jump List, headphones / call pause, alarm, OBS overlay, PiP, drag from Explorer | M | Small, many, each a reason to stay |
| 9 | Everywhere (2.0) | The mobile version (Android, then iPhone: the owner's ask 2026-11-02, [ideas/mobile.md](ideas/mobile.md)), macOS and Linux builds | L | Riff's one platform lead; the owner wants Legato on the phone |

Kept apart (need the user's call or an outside step): Spotify playback paths, Spotify's web session, LLM playlists with a
user key, SoundCloud playback and search (its terms), concerts (an API's terms), trademark search.

### Against Liner (user's ask 2026-11-05: lead it on every point)

Liner (`tryliner/desktop`): Electron, Windows / macOS / Linux, an account on its server, YouTube's audio taken and
served from its own copies (never ours: CLAUDE.md). The comparison, row by row, and each line's detail:
[ideas/liner.md](ideas/liner.md). Already ahead: weight, no account or limits, privacy, the phone, languages in the app,
the visualizer, the library, the player's tools, updates. Already ours too (checked 2026-11-05): the instrumental mark,
the settings search in every language, an everywhere shortcut for picture in picture, brand channels, recent searches,
Discord's buttons, the taskbar's thumbnail buttons, issue forms.

Numbered easiest first (the owner's ask 2026-11-05: all of them, by difficulty). Built hardest first: the owner's
ask for the autonomous run of 2026-11-05 evening,
with the interface on top (U1, U2 below): ours does too much on a phone, and lacks the glow and the simplicity Liner
has (inspiration only, never its code or assets). Never copied: their playback (YouTube's audio taken, their own
copies, downloads for offline), their accounts, limits and paid plan.

- [ ] 6. `S` A native window on Windows 11: snap layouts on our maximize button (`WM_NCHITTEST` → `HTMAXBUTTON`,
      beside `thumbbar.rs`), Windows' minimize and maximize animations.
      The owner's choice 2026-11-11: together, with the owner at the PC (not built blind).
      Left by the autonomous run (2026-11-11): WebView2's own child windows cover the title bar, so the hit test has
      to be answered there and the button's hover and click redone by hand; a mistake breaks the window's buttons for
      everyone, and it can't be tried without a screen. With the owner at the PC.
- [x] 11. `S-M` Share links that open in any browser: a static page on the website reads the playlist from the link's
      fragment, Open in Legato, Listen on YouTube, Get Legato.
      2026-11-11: Share's Copy gives `https://clovis500c.github.io/legato/l/#<code>` (`share::WEB_LINK`), read back
      by the app like its own links; the page (`site/app/(share)/l`, `sharelink.ts`) lists the songs with Listen on
      YouTube / Apple Music, Get Legato, and reads the bytes Rust wrote (a test on both sides). Fixed on the way:
      Ctrl+V anywhere didn't know `legato://playlist/` links, only `musicapp://` (`isShareCode`). Decided alone
      (2026-11-11): no "Open in Legato" button, the `legato://` link type isn't registered with Windows (Features >
      Low's deep links), so the page copies the app link to paste instead; no covers (they would load from YouTube's
      host); the page in English only. A link copied before the website is deployed with this page opens a 404
      until the push. Not tried: the page in a real browser (only `next build`'s export and the decoder's tests), a
      10 000-song link's length in a chat app.
- [x] 12. `S-M` A moving cover background (our own WebGL shader): Now Playing, Karaoke, the Cover display, behind Home
      as an option; under 3 % CPU.
      2026-11-11: Settings > Appearance > Flowing background (`backdropFlow`, off: Decided alone, it needs the owner's
      eye), `flow.ts`: the blurred cover warped by two slow sine rounds, a quarter of the size, 30 fps at most, still
      when paused or hidden, off with animations off, the still backdrop when WebGL is missing; on every screen with
      a backdrop (Now Playing, Karaoke, Cover display, full-screen visualizer, picture in picture). Not built: behind
      Home. Not tried: the shaders compile in Chromium, nothing more; never seen moving, its CPU never measured
      (the 3 % is unproven), a cover change's fade unseen.
- [ ] 15. `M` SoundCloud sets and likes: set aside (the owner's word, 2026-11-07). Its API terms (§01, §03, §10.4)
      forbid rebuilding its sets on YouTube without a registered app of theirs. Today's way, untried: Tune My Music's
      CSV export through Add music › song list.
- [ ] 16. `M` Reach: left, microsoft/winget-pkgs#474341 merged by Microsoft's moderators (submitted 2026-11-07; then
      a manifest per Stable, `packaging/README.md`). Done: the website in 18 languages, README screens, Discussions;
      no Scoop (decided alone).
- [ ] 17. `L` Listening rooms over the internet, no server of ours: sealed control messages through a public relay (the
      owner's call), or the LAN. Takes in "Listen together on the local network".
      - [ ] The internet half (the owner's choice 2026-11-07): WebRTC data channels, offers sealed with the room code
        and swapped once through public Nostr relays (relay.damus.io, nos.lol), Cloudflare's STUN for each side's public
        address; no TURN, so two strict NATs can't meet. The relays see the room's random id, both public IPs and the
        times, never songs, names or reactions: a privacy row says so.
- [ ] 18. `L` A Linux build (AppImage, deb): WebKitGTK, the MPRIS media panel, the tray, PipeWire for the detector.
      Built by GitHub's Actions (the owner's word, 2026-11-07); local tries in WSL or a VM once the owner sets one up
      (a system change, theirs). 19 the same, on a macOS runner.
- [ ] 19. `L` A macOS build, unsigned first as Liner's (signing: the owner's Apple Developer Program): WKWebView, Now
      Playing, the menu bar. 18 and 19 take in Features › High's macOS and Linux line.

### Platforms (milestone 3, user's ask 2026-10-31)

What the services allow, read on 2026-10-31 (specs in [ideas/catch-up.md](ideas/catch-up.md)):

- **Spotify, official API:** reads a user's own playlists, but a Development Mode app needs a Premium owner, so never free
  ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)).
- **Spotify, web session:** the token needs the TOTP hidden in the web player's code. Rebuilding it defeats a technical
  protection: never. Reading what the signed-in player shows needs neither that token nor that secret (each row has its
  title, artists, album, duration and track link: checked on a public playlist, signed out, 25 rows drawn of 50, so it
  scrolls). But Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) ban scraping, by hand or
  automated, and a breach can close the account (no such ban found in a search). The user took that risk on 2026-10-31,
  and the app says it before the first connection.
- **SoundCloud:** its [API terms](https://developers.soundcloud.com/docs/api/terms-of-use) bar scraping, require a
  registered app, and bar a playback experience that mixes its content with other services'. Its site terms restrict
  players used to build a streaming service (read as a summary only: the full page didn't load). So links imported
  as metadata first; playback and search are the user's call.

- [ ] `S` Connect Spotify, not tried yet: playlists inside a library folder, a collapsed library column, an expired
      session, the window covering Legato while it reads (Cancel in the toast may be behind it), a list with local files.
- [ ] `M` Likes and adds sent to Spotify (Send only, Both ways): official API only, so a key and a Premium account, also
      to test it. No way without them: Exportify only reads, and pressing hearts in Spotify's page would be a bot on the account.
- [ ] `S` per service: public playlist links from more services (TIDAL, Qobuz, Amazon Music), same flow as Deezer. Nothing
      checked yet.
- [ ] `L` SoundCloud playback in its official embedded widget (no audio taken). User's call first: see its terms above.
- [ ] `M` SoundCloud search beside YouTube's (widget playback, its terms checked first). The only keyless way is the
      site's own client id, which its API terms rule out: not advised.

### Features, sorted (user's ask 2026-10-31)

Three groups, easiest first inside each. The tag is the effort from the specs (a guess where there's no spec yet).
Importance is a first estimate (2026-10-31), the user moves lines as they like.

- **High**: most listeners would notice it, or it removes a reason not to switch.
- **Medium**: a real gain for one kind of listener.
- **Low**: niche or fun, for later.

**High**
- [x] `S-M` Same loudness across sources: YouTube vs local vs Spotify levelled by the Adaptive Sound meter.
      2026-11-11: Volume levelling (Song / Album) now covers YouTube: each video's loudness heard on a play of 30 s or
      more is kept (this PC), its next plays raised toward -14 LUFS in live.js (`docs/playback.md`). Decided alone
      (2026-11-11): boosts only, since YouTube's normalisation turns loud videos down after our measure; the first play
      of a video as it is. Spotify plays in its own app: out of reach. Untried for real (the ±1 LU of a mixed queue
      not measured; whether the embed's element volume carries YouTube's normalisation is from memory).
- [x] `M` Accessibility pass: full keyboard, screen reader labels, contrast AA everywhere, reduced motion.
      2026-11-11, what the sources prove: `ui/src/app/a11y.test.ts` fails on a `<button>` without a name (its text,
      `aria-label` or `title`: none was missing) and on a control shown on hover only (`hidden group-hover:grid` is
      out of Tab's reach: the album and artist pages' Play buttons were, now `sr-only` and shown on keyboard focus
      too). Contrast AA was already tested on every theme and every accent's palette (`theme.test.ts`); dialogs already
      kept and gave back the focus. Windows' "Animation effects" off now stops every CSS animation and transition, as
      Settings › Animations does. Untried: a screen reader (Narrator, NVDA) on the real app, Tab through every page,
      the JS-driven motion (Now Playing's drift, the flowing background, the visualizers) under Windows' setting (they
      follow Settings › Animations only), the user's own themes' contrast (the theme editor warns, nothing enforces).
- [x] `L` Personal servers: Jellyfin, Navidrome / Subsonic, Plex (the user's own music, streamed legally, keychain login).
      The three kinds in (2026-11-06), untried on a real server of any kind.
      Spec: [ideas/lead.md](ideas/lead.md) › Personal servers; how it plays: [playback.md](../playback.md) › Your music
      server.
      - [ ] `S` Plex's Sign out ends nothing at Plex: the account's token is dropped at the pick, and an owned server's
        token can be the account's own; Legato stays in plex.tv › Authorized Devices until the user removes it there
        (the privacy row says so). Revoking it needs the account token kept, or a documented device-removal call.
        Skipped 2026-11-11 (decided alone): the repo knows no documented removal call (developer.plex.tv's API reference has
        none for a device; the one clients use, `DELETE plex.tv/devices/<id>.xml`, is the legacy undocumented one), and
        it needs the account token, which is dropped at the pick on purpose (only the server's own token is kept). Keeping
        the account token longer widens what a keychain leak gives: not for a call we can't check. The privacy row already
        tells the user to remove the device at plex.tv.
      - [x] `S` Plex's covers keep the address in use at the sync: away from home on its plain http LAN address (when
        its plex.direct https one didn't answer), a cover asked before the next sync goes with the token to whatever
        answers at that LAN address. Store covers by machine id (`plex:<id>/…`) and sign them at the address in use.
        2026-11-11: covers kept as `plex:<account key>/photo/…` and signed at the address in use (`Plex::sign`, `Conn::cover_base`);
        rows synced before keep their old http cover until the next sync rewrites them. Decided alone (2026-11-11): the
        account's key (machine id + user) rather than the bare machine id (two users of one server have two tokens). Untried
        on a real Plex server: mock tests only.
      - [ ] `S` Plex's JWT sign-in (clients.plex.tv, a device key pair, the token refreshed each week) if Plex retires
        the legacy PIN's long-lived tokens.
      - [x] `S` Plex's transcoder (`music/:/transcode/universal`) for formats the engine can't read.
        2026-11-11: the player's second try (transcode) asks `music/:/transcode/universal/start.mp3` (`protocol=http`,
        `directPlay=0`, `musicBitrate=320`), no Range (a seek reads again from 0 and skips). Decided alone (2026-11-11):
        MP3 at 320 like the other two kinds, not Plex's HLS. Untried on a real Plex server: mock tests only, so the
        parameter set (`directStream=0`, `.mp3` suffix) is from memory of Plex's clients, not checked on a transcoder.
      - [x] `S` Trust a self-signed server: its certificate's SHA-256 fingerprint shown at sign-in and pinned (rustls's
        own verifier on every platform, so a pinned one is checked, not just accepted).
        The owner's choice 2026-11-11: yes, built by Opus with tests (a wrong fingerprint refused, an expired certificate
        refused), as its own branch.
        Skipped 2026-11-11 (far bigger than `S`, not provable here): desktop clients use native-tls (SChannel), so "rustls's
        own verifier" means a second TLS stack for servers; a pin must reach every client that talks to a server (the shared
        `servers::http()`, Plex, the player's streams, the art cache), per account instead of one `LazyLock`; and a pinned
        self-signed leaf with CA:TRUE (openssl's default) fails rustls's end-entity check, so the verifier needs its own
        pin-then-validate rules. Tests need a TLS test server and generated certs (no `rcgen` / `tokio-rustls` dev
        dependency yet) to show a wrong fingerprint, an expired and a mismatched certificate refused. Do it as its own
        branch with the owner.
        Built 2026-11-12 (on `platforms`, not its own branch): a pinned host's requests go to one rustls client
        (`connectors::pin`), the rest stay on the system's TLS; the pin is checked by webpki with the certificate as its
        only root (dates, handshake), name and CA flag excused. Tests with rcgen certificates and a real TLS handshake on
        127.0.0.1. Not tried for real: a real NAS's certificate, the sign-in screen, Android; Plex not offered (its
        sign-in is plex.tv's).
      - [x] `S` Server songs levelled: OpenSubsonic's `replayGain` (track / album) into Volume levelling.
        2026-11-11: asked with `getSong` as a song is about to play (once per song and run of the app), used like a
        file's ReplayGain tags. Not done: Jellyfin's `NormalizationGain` and Plex's loudness (other scales), a gain
        kept in the library (asked again after a restart). Untried on a real server: mock tests only.
      - [ ] `S` Your music server in the app's search (`Conn::search` built for the three kinds, not wired). Decided alone
        (2026-11-06): left for later; the library mirrors the whole server at each sync, so its songs already come
        up in the library's own search; the server's search would only add what came since the last sync.
        Skipped 2026-11-11 (decided alone): nothing a user would see beyond that gap (songs added in the last 30 minutes),
        while wiring costs a server request per search on every account and a "not in your library" result kind that
        plays without being in the library. Revisit if a sync gets slower than 30 minutes.
      - [ ] `S` Playlist edits sent back to the server (`updatePlaylist`, `createPlaylist`) when its direction sends.
        2026-11-11: a Subsonic server's playlists take songs (Add to playlist, a drop on the sidebar) and lose them
        (Remove from) from here, sent with `updatePlaylist` in the background and undone here when refused; a
        removal reads the server's list first (it removes by position). Left: `createPlaylist` (a playlist made
        here stays here), renames and order, Jellyfin and Plex (read-only, said in words). Untried on a real
        server: mock tests only.
      - [x] `S` Servers that refuse token auth (Subsonic code 41: LDAP users, some Ampache / Nextcloud Music setups): the
        password sent hex-encoded (`p=enc:`) after a warning, https only. Today the sign-in says "doesn't take this kind
        of sign-in" (translated since part 2, with the three other messages the 2026-11-06 review found in English).
        2026-11-11: code 41 now says the server only takes the password as it is; on an https address the form shows the
        warning and a "Send my password as it is" button, the account kept with `plain_password` (`p=enc:<hex>`, refused on
        http everywhere). Code 42 keeps its old message. Decided alone (2026-11-11): a button after the first failed
        sign-in rather than a checkbox up front (nothing sent as it is unless the server asked). Untried on a real server:
        mock tests only.
- [ ] `L` macOS and Linux builds (media panel, detector, tray per OS).
- [ ] `L+` Mobile version, well optimised, the Rust code reused (the owner's ask 2026-11-02): Tauri 2's Android target
      with the same crates and `ui/`, Android first, iPhone after. Spec, seven phases, what stays desktop-only and the
      owner's calls (Android SDK / NDK on this PC, a phone, GitHub or Play Store, YouTube sign-in in a WebView):
      [ideas/mobile.md](ideas/mobile.md). Phase 1, the phone layout in `ui/`, done 2026-11-02; phase 2 needs the owner's
      Android tools.
      The owner's ask of 2026-11-02: the mobile app working completely, synced with the PCs over Wi-Fi both ways, then
      a Beta with the APK; Android first; YouTube signed out on the phone, the library from the PC by sync.
  - [ ] iPhone: not for now (the owner's word, 2026-11-07); later, their signing choice (Apple Developer Program, or an
        unsigned .ipa).

**Medium**
- [ ] `S` Community: GitHub Discussions (on since 2026-11-07, with the "good first issue" label) linked from About, a
      showcase of themes on the website.
      2026-11-11: Settings > About > Community opens the Discussions. Left: the website's showcase of themes (it
      needs themes to show: the owner's or the first shared ones).
- [x] `S-M` Discovery: new releases of your artists from MusicBrainz only (the owner's choice 2026-11-07, no Reddit),
      shown as cards to play from YouTube; its host in the website's privacy rows.
      2026-11-11: Home's section "New from your artists" (`releases`), off until turned on in Customize Home
      (Decided alone: it sends artists' names to a new host). The ten artists listened to most, one request each a
      second apart, once a day, the last 60 days, kept in this PC's library (`connectors/musicbrainz.rs`,
      `core/discover.rs`, `src-tauri/discover.rs`); a card opens the app's search on "artist title". The privacy row
      The owner's choice 2026-11-11: stays off by default; covers from Cover Art Archive as an option (open line below).
      Is on the website. Not done: covers (Cover Art Archive is one more host), a purpose of its own in Settings >
      Privacy (musicbrainz.org shows under Other), artists told apart by id (same names: the credit's name must
      match, no more). Never tried against the real service: the answer's shape and the date range in the query come
      from their docs (mock tests only).
- [ ] `S-M` Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
      Left by the autopilot (2026-11-05): `watch.js` already hides the column the panel sits in (`#secondary`, `#below`)
      and pauses at the end; what's left needs a real watch page, behind YouTube's cookie choice in a new profile.
- [ ] `M` Lyrics translation in the panel (a service sends text: add the website's privacy row first).
      Owner's call (2026-11-01): which service gets the lyrics (the user's own DeepL or Google key, a LibreTranslate
      server); Windows gives apps no offline translator. The panel side is small once that's chosen.
- [x] `M` MusicBrainz lookup that fills Edit song info (album, year, numbers from a release): a new host, the website's
      privacy row first.
      2026-11-11: Edit song info (one song) › Look up on MusicBrainz: one recording search by title and artist
      (`musicbrainz::song_releases`), up to 8 releases (official, plain albums, the album typed, the earliest first;
      takes over 10 s longer or shorter left out) to pick from; a pick fills album, album artist, year, track, disc, and
      Save writes as before. Website: a "Song info lookup" privacy row. Decided alone (2026-11-11): one song only (a
      whole album's numbers would need the release's track list, a second request); no genre (not in the search).
      Untried against the real MusicBrainz: the answer's shape is from their docs.
- [ ] `M` Equalizer presets per output device (headphones vs speakers) and AutoEQ profiles for known headphones.
- [x] `M` BPM / key tags; genre / year of streamed songs (Spotify's export has a release date; iTunes a genre);
      smart playlist rules on them (mixes, DJ-like transitions by BPM).
      2026-11-12, local files' half: schema v22 (`bpm`, `key`, filled by the next scan from TBPM / tmpo and TKEY / initialkey;
      a tempo outside 30-400 or a key over 12 characters is dropped), Songs' BPM and Key columns (off by default, Settings
      › Columns) and Tempo sorts. Not done: streamed songs' genre / year / tempo (no source gives them without a new host),
      tempo-matched transitions. 2026-11-12: Edit song info edits them (BPM 30-400 or emptied, key 12 characters at most;
      written to the file's TBPM / tmpo and TKEY / initialkey, the library row following). 2026-11-12, smart playlists: rules on Genre (contains / is /
      doesn't contain), Year and Tempo (BPM) (at least / at most; a song with no tag fails a number test, as unrated songs do for
      ratings): `rules.ts`, the rule editor. Never seen on a screen. Never seen on a screen.
- [ ] `M` Mixes: genre / year tags (stored for local files only), Last.fm "Discoveries" (user's key); "Never in mixes"
      on a discovered song (not in the library: no row to hold the choice).
      2026-11-12, the genre / year half: "Your {genre} songs" (up to 2) and "Your songs of the {decade}" (up to 2) mixes from the
      tags of local files (8 songs at least, left out when they repeat another mix; `mixes.rs`, titles in `words.ts`). Left open:
      Last.fm "Discoveries" (the user's key) and "Never in mixes" on a discovered song. Never seen on a screen.
- [x] `M` Internet radio stations (Radio Browser's open directory).
      Skipped by the autonomous run (2026-11-11): bigger than `M` once looked at. The engine plays HTTP only as a
      server song (`server:` paths through the shell's server fetcher, `crates/player/src/http.rs`), and a live stream
      has no length; a station would be a new `Source` (14 interface files and 25 Rust sites branch on `server`), and
      rodio is built without ADTS AAC (`crates/player/Cargo.toml`: many stations stream AAC, an added decoder and
      licence check). Split into: (1) `S` connector `radio_browser.rs` (`all.api.radio-browser.info`
      `/json/stations/search`, `hidebroken`, codec MP3 / OGG first; a User-Agent naming the app) with the website's
      privacy row; [x] 2026-11-11: `radio_browser.rs` (`RadioBrowser::search`, `Station`; HLS, dead and non-http streams dropped, MP3 / OGG
      first) and the website's "Internet radio" row; nothing calls it yet (the row is written for step 3), its error words
      aren't in `errors.ts` yet. Untried on the real directory: mock tests only. Decided alone: `all.api` name (the
      directory's round-robin) rather than its DNS server list; (2) `S` the engine's endless stream (a plain GET fetcher, no ICY metadata asked, no seek, no
      length); [x] 2026-11-11: `server:radio:<address>` paths (`http::RADIO`), `Stream::open_live` (a plain 200, no length, a
      cut or an ended stream reconnects and carries on, a seek outside the buffer refused), `radio_browser::open` (plain GET,
      http / https only, no `Icy-MetaData`) behind the shell's fetcher. Nothing in the interface starts one yet (step 3);
      untried on a real station (mock and local-server tests only). Decided alone: a station is not forced to MP3 / OGG
      here (the decoder's error says so for AAC, step 4); the station's address is not checked against private ranges. (3) `M` a `radio` source and a Radio page (search, play, keep a station), Up next and history skip it; [x] 2026-11-11: no new `Source`: a station
      is a recommendation-like track (not in the library) whose `ids.server` is `radio:<address>` (`features/radio/station.ts`),
      played by `server:radio:<address>` (step 2); Radio page in the sidebar (`RadioView`: search, play, keep with a heart; kept
      stations in the library's settings, `radio.rs`), history already skips remote tracks, a station is never starred or
      scrobbled to a server (guards in `like.ts`, `servers.ts`). Not done: a phone tab, the station's own metadata (no ICY),
      "live" instead of a progress bar in Now Playing, favicons, the directory's other searches (country, tag). Never seen
      on a screen nor against a real station.
      (4) `S` AAC streams (symphonia's AAC + ADTS, `cargo deny`). The owner's choice 2026-11-11: AAC too.
      [x] 2026-11-11: nothing to add: `rodio`'s `mp4` feature already compiles symphonia's AAC codec and its ADTS reader, so no
      new dependency (`cargo deny` unchanged); a test plays made-up silent AAC-LC ADTS frames as a station (garbage fails).
      Untried on a real AAC station; HE-AAC (SBR) and LATM streams are not read (said in docs/playback.md).
- [ ] `M` Release radar: new releases from artists in the library (YouTube Music / MusicBrainz).
- [ ] `M` Credits and artist pages: who wrote / produced (MusicBrainz), a short bio (Wikipedia), links out.
      2026-11-12, the links out only: an artist's page has "Find links on MusicBrainz" (a click, two requests a second apart, the
      name only; `MusicBrainz::artist_links`: the artist by exact name with a score of 90, then its url relations, http(s) of 8
      kinds, 12 at most), opened in the browser; the website's "Artist links" privacy row. Left: who wrote / produced (recording
      relations: a request per song), the Wikipedia bio (two more hosts). Untried against the real MusicBrainz: the answers'
      shape is from their docs. Decided alone (2026-11-12): on a click, never on opening the page.
- [ ] `M` Sweet fades (Plexamp): crossfade length picked per pair from the songs' ends (loudness, silence, tempo).
      (Left by the autopilot (2026-11-05): a song's end is only known measured (local files, Skip silence on) or
      heard once (a video, `ends.ts`), its tempo not at all; the overlap is the player's most fixed code, and a
      length picked per pair needs an ear to tune: with the roadmap's Sonic analysis, or with the owner listening.)
- [x] `M` Classic skins: a compact "mini" layout (Winamp-like) with the user's theme; a YouTube song keeps its video at
      200 px beside it (the owner's choice 2026-11-07: YouTube's 200 × 200 rule).
      2026-11-11: Settings › General › Classic mini player (off) turns picture in picture (P) into a 656 × 200 strip:
      the video (or the cover) at 356 × 200 on the left, then the time, a scrolling "artist – title" (still with
      Animations off or reduced motion), the seek bar, the whole transport, the mini visualizer. Decided alone
      (2026-11-11): built on picture in picture (same window, above the others) rather than a third layout; the strip's
      place kept for the run only. Never seen on a screen: the strip's fit at 200 px, the marquee's speed.
- [x] `S` Lyrics: `SONG ENDS`, `NEXT SONG`, `PREVIEW` in normal case (the owner's choice 2026-11-07; keys in all 17
      languages).
      2026-11-11: they are the fade editor's two marks and the song lists' 30-second badge, not the lyrics. "Song
      ends", "Next song"; the badge says "Sample" (Decided alone: "Preview" is already the key of the settings'
      visual preview, with other translations). Not seen on a screen.
- [ ] `M` Long YouTube mixes and DJ sets split by their chapters (or timestamps in the description / pinned comment):
      each part a song in Up next, skip within the video; Music Detector names unlabelled parts on request.
- [ ] `M` Output devices: switch from the player bar, remember per device (volume, EQ preset).
- [ ] `M` Right-to-left languages (Arabic, Hebrew: mirrored layout) and community translations (Weblate), more languages.
- [ ] `L` Cast: DLNA / UPnP speakers and Chromecast for local files and personal servers.
- [ ] `L` Sonic analysis, ours and local: features (tempo, key, energy, brightness, mood) computed from local files, and
      from what plays live for streams (the meter already listens; measured, not extracted), stored per song. Feeds
      "similar songs", song radio, sweet fades, the path between artists (Plexamp's Sonic Analysis needs a server).

**Low**
- [ ] `S` Focus / workout sessions: a timer, no-lyrics or high-BPM mix, a summary after. (Left by the autopilot
      (2026-11-05): no tempo or energy data yet, so no high-BPM mix: the roadmap's "Smarter listening" analysis first;
      the plain timer is the sleep timer.)
      2026-11-12, the tempo half: with the tempo tags of local files, the Mixes page has "Up tempo" (120 BPM and above) and "Slow
      down" (90 and below), 8 songs at least (`mixes.rs`). Left: the session itself (timer, no-lyrics filter, summary), a taste
      call about what a session is. Never seen on a screen.
- [x] `S` Hide explicit songs (a filter, YouTube Music's flag when there is one). (Left by the autopilot (2026-11-05):
      no explicit flag is stored. The sources give it (YouTube Music's E badge, Exportify's Explicit column, iTunes'
      `trackExplicitness`): a `Track` field, a schema step and three parsers, an `M`.)
      2026-11-11: `Track::explicit` (schema v21, kept once any source says so), read from YouTube Music's
      `MUSIC_EXPLICIT_BADGE` (rows, Home cards, radio queues), Exportify's column 14, iTunes' `trackExplicitness`;
      Settings › Appearance › Hide explicit songs (`hideExplicit`, off) leaves them out of Songs, imported playlists and
      mixes. Decided alone (2026-11-11): your own playlists keep them (their rows are edited by position, like the
      non-music fold); album, artist and search pages not filtered yet; Apple Music's playlist pages and Spotify's own
      page rows give no flag. Songs already in the library are marked at their next sync. Untried on real answers: the
      badge's name and the column are from memory of their formats, mock tests only.
      The owner's choice 2026-11-11: filtered everywhere, but only hidden, with a way back for the user if the flag is
      wrong: see the open line under "The owner's answers of 2026-11-11".
- [ ] `S-M` Volume: per-source volume memory (its own setting and a switch rule, a taste: the owner's call). The
      curve stays as it is (the owner's word, 2026-11-07).
- [ ] `M` Concerts near the user from followed artists (a public API with no account; privacy row).
- [ ] `M` A path between two artists (Plexamp's "Sonic Adventure"): a mix that walks from one to the other.
- [ ] `M` Describe a playlist in words ("calm rainy Sunday, no lyrics"): matched against the library's tags and sonic
      features locally; an LLM only with the user's own key (like Last.fm's), privacy row first.
- [ ] `M` Audiobooks from local files (m4b chapters, resume per book, speed, sleep at chapter end), apart from music.
- [ ] `M` Stream Deck plugin and an Xbox Game Bar widget (play / skip / like / now playing) over the local hotkeys.
- [ ] `M` Blind test game: snippets from the library or a playlist, guess title / artist, scores, local multiplayer
      on one screen or over the LAN code.
- [ ] `M` Theme and plugin gallery without a server: an index file in a GitHub repo, browsed from Add-ons, installed after
      the usual permission review; authors submit by pull request.
- [ ] `M` Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
      clicked in a browser (deep-link registration).
- [ ] `M-L` Practice mode for musicians: A-B loop, slow down without pitch change (Live Editor has it), key and chords shown,
      count-in / metronome on the song's tempo.
      2026-11-12, the A-B loop: the player's menu has A–B loop (Loop starts here / Loop ends here / Clear the loop); at the end the
      song goes back to the start, from the position the player reports (`abLoop.ts`, no engine change, so the turn is a
      quarter of a second late on a file); it goes when another song starts. Left: key and chords shown, a metronome.
      2026-11-12: the loop has a key (L: start, end, clear, in the shortcuts table) and a band on the progress bar. Decided
      alone (2026-11-12): L, one key cycling the three steps, rather than three keys. Never tried by ear or on a screen.
- [ ] `M-L` Profiles on one PC (each person's library, likes, history and Last.fm), switched from the top bar.
- [ ] `L` Exclusive WASAPI output / bit-perfect for local files (foobar's audiophiles).
- [ ] `L` Podcasts by RSS (open feeds only: no platform audio taken), resume per episode, speed.
- [ ] `L` Living-room mode: big UI driven by a gamepad or the arrow keys (10-foot layout), for a PC on a TV.
- [ ] `L` Media panel off Windows.

## Visualizer v2 (user's ask 2026-10-30: more realistic, more detailed)

First cut on Stable since 1.1 (`docs/playback.md`): 1/6-octave bands at 60 Hz from both twins, one canvas in a worker
drawn at 30 fps, eight looks (LED, Bars, Mirror, Peaks, Wave, Radial, VU needles, Spectrogram), the strip under the cover
and full screen on V. The lines left are in no milestone yet. Sorted like the features; both twins stay alike (`crates/dsp`
and `live.js`), and a look waits for the data it needs. Each look has a few settings: bands, smoothing, peak hold,
colours, mirror, reflection.

**High**

**Medium**

**Low**

## Workflow (how we build it)

Today: every green push to master is a Beta prerelease (479 commits so far, check 5-11 min then release 10-16 min) and
Stable goes out by hand (`promote`); the smoke test runs on every push; `src-tauri/src/lib.rs` 2149 lines; CLAUDE.md
~15 kB read by every session.

Most useful first; the tag is the effort.

- [ ] `M` The "Check live in the real app" list as a scripted checklist (a dev-only page that drives each step and logs the
      result), so a pass takes minutes, not a session.
- [ ] `S` Faster CI: run the macOS job only on pushes that touch Rust or `src-tauri`, `cargo nextest`, `sccache`; Linux
      job stays crates only.
- [x] `S` Trim CLAUDE.md to rules + pointers (structure details move to `docs/architecture.md`): cheaper sessions. 2026-11-11: only the Layout section had descriptive text; its crate one-liners moved to `docs/architecture.md` › Layout details, every rule line unchanged (the diff removes lines of Layout only). A small saving (about 10 lines): the other sections are rules. Decided alone (2026-11-11): the per-crate rules (SCHEMA_VERSION, plugins' limits, Android's) stay in CLAUDE.md rather than becoming pointers.
- [ ] `M` Split `src-tauri/src/lib.rs` by feature (library, player, accounts, sources) like `detector.rs` / `editor.rs`;
      same for `crates/core/src/library.rs` (queries per table).
- [ ] `M` Typed `invoke` wrappers: the types are generated, the wrappers in `api.ts` stay by hand (no `tauri-specta`), so a
      command's name and arguments are still checked by eye.
      2026-11-11: the names are checked (`api.test.ts` reads `generate_handler!`: a wrapper calling a command the
      shell doesn't have fails). Left: the arguments' names and types.
- [ ] `M` Diagnostics: a crash that ends the process without a Rust panic (a native fault, a kill) leaves no line; Windows'
      event log and minidumps are not read.
- [ ] `S` `graphify hook install` (the user's go) so the graph stays fresh without asking; then drop the `.gitattributes`
      line it adds (the graph isn't tracked).

## Optimisation (how it runs)

Most useful first; the tag is the effort.

- [x] `M` Library at scale, the rest: search with FTS5, scans in the background with progress.
      Skipped 2026-11-11 (measured, not needed): the library's search runs in the interface over the songs it already
      holds (`search/match.ts`, each song's folded names made once): 50 000 songs answer in about 7 ms a keystroke
      (Vitest, this PC), 240 ms once to build the forms. FTS5 would add an IPC round trip and can't keep its rules
      (inside a word, "acdc" for AC/DC: substrings, not tokens). Scans already run off the window's thread
      (`rescan`, `spawn_blocking`); left: their progress, a small `M` with its own Channel, not started.
      2026-11-12: the progress half: `local::scan_with` reports files read of those new or changed, `rescan` tells the
      interface (event `scan-progress`, at most 5 a second), Songs' subtitle reads "Reading your files… 120 of 4,300" while a
      folder is read (`scanProgress.ts`). FTS5 stays skipped (measured). Never seen on a screen or on a 10 000-song folder.
- [ ] `S-M` YouTube embeds: one player reused instead of one per song where the crossfade allows; unload the hidden one.
      Left by the autopilot (2026-11-05): playback-critical, and the demo has no YouTube player to try it on.

## Check live in the real app (built and unit-tested, never driven for real)

- [ ] Connect Apple Music on the owner's account (the owner's ask to keep it in mind, 2026-10-31): All Playlists read with
      covers, a long library playlist and Favorite Songs read to their end, the `media-user-token` cookie ending the
      sign-in step, a second import updating the lists. If it breaks, `apple.js`'s selectors are the first suspect (only a
      public playlist page was seen).
- [ ] YouTube Music every 15 minutes: offered after a Google sign-in, runs while the app is open, silent on a refusal.
- [ ] A Legato link between two PCs: its videos come in named, no search.
- [ ] A SoundCloud song link pasted, and an `on.soundcloud.com` short link from SoundCloud's phone app: named, found on
      YouTube, added; a set's link says why it can't.
- [ ] Settings › General › Back up your library, then Restore a backup: the app restarts on it, playlists and history
      as saved, `library-before-restore.db` beside the library.
- [ ] A folder and a few songs dropped from Explorer: the folder in Settings › Accounts › Local files, the songs in the
      library after a restart, the notice's Play; songs already there play at once; a QR picture still opens a shared list.
- [ ] Start radio from an album, a playlist and the artist page, signed in to YouTube and signed out: its own songs one
      in three, Up next naming the radio, more songs coming at its end with autoplay off.
- [ ] The search bar's pages, actions and settings: "shuffle", "dark", "stats", Enter on each, in French too.
- [ ] Headphones unplugged, then a Bluetooth headset turned off, each while a song plays (YouTube, a local file): paused
      at once, the notice's Play goes on; with the setting off it plays on through the speakers.
- [ ] Windows' default output switched by hand while a local file plays, then while it's paused: it goes on (or waits)
      on the new device at the same place.
- [ ] Shuffle a playlist of a few artists: no artist twice in a row in Up next, the songs played today at the end.
- [ ] Mixes page at an hour you listened at on the same weekday two weeks running: "Your Friday evenings", in French too.
- [ ] A Teams test call with Pause during calls on, a song playing: paused as it starts, plays on as it ends. Also with
      Windows' Communications set to Do nothing (does Windows still say it?), and a call on another device.
- [ ] An album played from its first song with a fade set: no dip between its songs (YouTube Music album and local
      files), a playlist of singles still fades, the sleep timer's last song still fades out.
- [ ] "No sound could be taken" gone from the second YouTube video on (fix 51946d5).
- [ ] A real update from 0.1 (user's PC): Legato installed, old folder and its shortcuts gone, library, sign-ins and Open
      at startup still there.
- [ ] A real network cut (Wi-Fi off while a YouTube song starts): paused, one message, restarts on its own. Only emulated
      so far (DevTools cuts the page, not YouTube's out-of-process frame).
- [ ] Add to a YouTube Music playlist from an album page (cause of `STATUS_FAILED` assumed = duplicates); toasts + Undo
      / Add anyway; advanced fade by ear (curves, fade on skip, fade on pause); Home's YouTube Music shelves on a real
      account (unofficial API); Home items not in the library; new mixes after real listening; exact restore after an
      update.
- [ ] Tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user owns, blocked video falling
      back, Auto on a real music video, resume after a real restart, sort Most played.
- [ ] Repeat one / repeat all at a track's end, menu actions that write (rename, delete, export, remove from playlist),
      local file covers, Apple cover backfill, Spotify covers, add another Google account, sign out.
- [ ] Landed the night of 2026-10-31, on Stable since 1.1, never seen on a real screen: Deezer and Apple links through the
      paste box (a real `link.deezer.com` short link too: tested on a recorded 302 only), Shift + wheel on a real mouse and
      the volume number, SponsorBlock turned on (a real intro skipped, Undo, marks on the progress bar), Skip silence across
      real crossfades, Karaoke on plain lyrics, with animations off, over a video in the watch page and at 60 fps on a long
      song (bench PC), a 10 000-song scroll asking only 64 px covers.
- [ ] One Liked Music (the owner's report, 2026-11-01: two in the sidebar after a Spotify import): yours, where imported
      likes wait for the YouTube account (its like refused here that day: 403), folded into the account's on every page
      (`features/library/likedMusic.ts`, the store's `raw` keeps both for the heart button and Remove from). Check: one
      entry in the sidebar, Home and search, the waiting songs on top of it, unliking one of them, a sync moving them over.
- [ ] A YouTube song that stayed black and silent until skipped away and back (the owner's report, 2026-11-01). Cause:
      Google's "Sorry…" page answers the embed's player request (403, after about 7 s) while it limits this PC's address,
      a third of the starts for hours after an import's 1840 searches (`diagnostics.log`: "YouTube refused searches | 125
      refused, 1715 answered"). `crates/shield/src/refused.js` tells the app at once: loaded again once (`playback` log:
      "Google refused the video, loading it again"); refused again, stopped with "Too many requests", nothing blocked, no
      watch page, no other upload searched. The clock waits for a new song's first report (it ran, nothing playing). The
      stuck check stays for slow networks (26 s). Check when it happens again: the log line, the song on about 8 s in.
      Imports now search one at a time, 3 s apart, and wait 5 min on a refusal (`searchpace::Pace`, the owner's call: an
      import of 1840 searches takes about 1.5 h instead of 30 min). Check on a real import: no `YouTube refused searches`
      line, playback fine meanwhile. Still fast: a pasted song list (6 at a time, `songlist.rs`) and Find versions (150 in
      a row, stops at the first refusal).
- [ ] The 2026-11-02 run (Beta 1.1.588), checked only by tests and over the demo:
      - Phone remote on a real phone (Settings › Playback): the QR code, the page, taps; Windows' firewall asks once.
      - OBS overlay in a real Browser Source; Settings › Privacy's real log of the day.
      - Pick up on the other PC (two PCs with Sync Mode): the toast once, then Resume in the idle player bar.
      - Cover display (C) on a real second screen; the display kept awake (WebView2's wake lock).
      - Share as a picture: a real paste into a chat app, a real save as PNG / JPEG.
      - Visualizer weighting and colour, by eye on real music (defaults unchanged); the cover's colour on real covers.
      - Library health page on the real library; Exportify's real names on a real export; the phone layout (a window
        under 640 px). Back to {month} shows only with months of history.
- [ ] The 2026-11-04 and 05 runs (the Beta of 2026-11-05), checked only by tests and over the demo:
      - Picture-in-picture (P) in the real window: small and above the others, dragged, back to a maximized or full
        screen one; a YouTube video in it; two screens.
      - The search on the real library: the order of your songs, a typo fixed, typing at 50 000 songs.
      - The alarm's real ring (from the tray, the PC awake or asleep); voice commands with real speech.
      - The taskbar's Jump List of an installed build; the recap's real save and copy; real tagged files (genre, year).
      - The accent from real covers; the Presets look with a real .milk file; "In the lyrics" on a real lyrics cache.
      - The phone's update on a real phone (from the Beta after 1.1.679): the toast, the download on mobile data and
        Wi-Fi, Android's permission page, its installer, the new version starting where the old one was.
- [ ] Against Liner (2026-11-05 on), checked only by tests and over the demo:
      - Keep the screen on (Settings › Playback › Screen): past Windows' screen timeout while a song plays, asleep as
        usual once paused; on the phone too (does Android's WebView grant the lock?).
      - The phone's interface (U1) on a real phone, light and dark: a long press and every ⋯ open a sheet, Android's
        Back closes it (and a dialog sheet) before leaving the page; the sheets and Now Playing clear the gesture bar
        and the notch (safe-area insets); the keyboard over a dialog sheet (a playlist's name) leaves its buttons
        reachable; every icon button answers a thumb's tap at its edge; Settings › More settings opens and a settings
        search opens the right fold; the mini player opens Now Playing on a tap, its heart and play don't. Judge the fold
        list and the moved controls (Reset history, previous only in Now Playing).
      - Glow and simplicity (U2): Settings › Appearance › Player › Glow at Off, Soft and Strong, in a dark and a light
        theme: the play button, the playing row's mark, the seek bar's played part, a switch that's on, the sung line,
        Now Playing's cover on a few real covers (a grey one: no glow); Off leaves nothing. More glow without too much?
        Does a song change stay smooth with Now Playing open (Task Manager's GPU column)? The player bar's More (picture
        in picture, sleep timer…), Now Playing's More (Karaoke, Cover display, Less like this), the moon back while a
        sleep timer runs, Back / Forward appearing once you've moved, Your library's Expand and Sort under the pointer.
        Judge the calmer look: anything missed is one class to put back.
      - Listening rooms (17, local half), a PC and the phone on the same Wi-Fi: the room shows in Join a room within
        3 s on both sides; the code and the QR join (a wrong code says so; 5 of them change the code); the listener
        starts the song within a few seconds and stays within 1.5 s of the host (pause, seek, next on the host); a
        song only on the host's disk is found on YouTube on the listener's side, or says "Can't find this song here";
        own pause and Catch up; skip on the listener says it follows the room; reactions float on both; End room and
        Leave; the host closing the app ends the room on the listener ("The room's host left"). Windows' firewall asks on
        the first room (TCP 47823): does a refused prompt leave a clear error? Android in the background: does the room
        keep up with the screen off? Settings › Privacy lists nothing new (no host is talked to).
      - Your music server (personal servers, part 1), with your own Navidrome (`docs/development.md` › Your music
        server): Sign in with its address, user and password (a wrong password says so; an address that isn't a server
        says so; a public http:// address shows the warning); the first sync brings its songs, albums and playlists
        (how long for your library? does the app stay responsive?); a song plays, seeks forward and back, hands over to
        the next without a gap, the Live Editor and the visualizer work on it; its cover shows; a like stars it in
        Navidrome and an unlike unstars it; a song played past half shows in Navidrome's recently played (and only
        then); Wi-Fi cut mid-song: it picks up or says "stopped sending"; an opus or other unusual file plays (the
        server's MP3); Sign out takes its songs away; Settings › Privacy lists the server's address. On the phone over
        Wi-Fi: the same song plays and seeks.
      - Jellyfin (personal servers, part 2), with your own (`docs/development.md` › Jellyfin and Plex): Server type
        Jellyfin, its address, user and password (a wrong password says so; a Jellyfin older than 10.9 says so; an Emby
        or a web page says it isn't a Jellyfin); Dashboard › Devices shows "Legato on Windows"; songs, albums,
        playlists and favourites come in; a song plays and seeks (a FLAC raw, an opus as the server's MP3); a like is a
        heart in Jellyfin, an unlike removes it; Dashboard › Activity shows the start and the stop; a song played past
        half adds to its play count (and one skipped early doesn't; one played to its end counts once, not twice:
        Jellyfin's own Stopped may count a play past 90 %, then `UserPlayedItems` adds one); Sign out removes the device
        from Jellyfin's list and the songs from the library.
      - Plex (personal servers, part 2), with your Plex account and server: Server type Plex › Sign in with Plex
        opens app.plex.tv in your browser with the code shown in the app; after you allow Legato there, the app goes on
        by itself within a few seconds (several servers: a picker; a shared one says "Shared with you"); Cancel stops
        it; a code left alone expires with a message. Songs and playlists come in (how long for your library?), covers
        show, a song plays and seeks; a like is 5 stars in Plex, an unlike clears them; a song played past half shows
        in Plex's history; away from home (phone on mobile data, or the server's port closed) does the row say Plex's
        relay, and does it play? Back home, the next sync leaves the relay by itself. Does `/identity` answer without a
        token (the sign-in finds the server)? Settings › Privacy lists plex.tv, the server's plex.direct address,
        nothing else.
      - The phone's fixes from your tries (2026-11-06, reviewed the same evening): Back from a playlist goes to the
        page before, at the root the app goes behind and the music goes on; Back closes a sheet, a dialog, the lists' i
        box, the visualizer, Karaoke and Now Playing first. A YouTube song outside Now Playing: no video over the lists,
        the sound on, Now Playing shows the video. The app opened on a Wi-Fi with no internet (a hotspot without data),
        a YouTube song played: Now Playing says "Can't reach YouTube…" with Try again, never the error page; the song
        isn't skipped, and plays by itself once the internet is back. (The internet lost mid-song with the Wi-Fi still
        up is another path, untouched: does it skip?)
      - Against Liner 3 to 5 and the round covers (2026-11-06 evening, Beta 1.1.750 by the dry run). Discord, Song and
        artist: "Listening to jinx – lexycat", the album under it; a YouTube song played 10 s shows the artist's small
        picture on the cover's corner, on a friend's screen too. Settings › General › Picture-in-picture on minimize:
        the title bar's minimize, Win+Down, a taskbar click and Win+M while a song plays open the small window (does
        the window show going down first?); that one minimized and restored from the taskbar gives the full window
        back; the sung line under the picture. Settings › General › Storage: do the sizes look right, does Clear on
        Lyrics and song analyses and on Diagnostics log free them (how long on your library?), is WebView2's size
        there? The radial look, and vinyl covers, on a YouTube upload with a 16:9 picture: round, the ring around it.
      - The 2026-11-07 work (the night's Beta: Against Liner 7, 9, 10 and the lyrics on the backdrop; then the
        autonomous run's local commits, not pushed yet: 13, 14, the website). Stats › Recap's last card, "My music
        profile": its numbers, top artists and playlists right, the saved picture. An import with doubtful matches: its
        end lists them, the videos side by side; a pick sticks, Approve all keeps the rest. Next 10 s into a YouTube
        song: quicker than before? (Copy diagnostics: the "time to sound" lines.) Now Playing's lyrics readable on a
        light cover? A big playlist's import (yours to run): the lists there at once, a song not looked up yet found as
        it comes up to play, the import screen's count going down; does YouTube refuse sooner than before? A song from
        your Navidrome or Jellyfin that has lyrics: the server's own first; the lyrics' source line › Other lyrics: the
        choices with their %, a pick kept after a restart and after the caches are cleared, Let Legato choose. The
        website once deployed: the story on your phone in the phone's layout; /legato/fr/ in French, the header's
        language picker.

## Waiting on the user (outside the code)

The owner's answers (2026-11-07, a quiz over the open questions; the lines they changed say so). Kept as they are: on
the phone a YouTube song plays out of sight outside Now Playing, SponsorBlock off by default, the volume curve, star
ratings in the library only (not in the files' tags), imports at one search per 3 s, no checking of every YouTube
video ahead, no Spotify previews, Android as the APK with its own updates (no Play Store).

- [ ] Plex's Terms of Service (plex.tv › About › Privacy & Legal): the page refused an automated read (2026-11-06), so
      nothing in them was checked. Sign in with Plex follows the PIN flow developer.plex.tv documents for apps, on the
      user's own server; whether Plex's terms say more about third-party apps is your read. Also your call: trying
      it with your account (`docs/development.md` › Jellyfin and Plex).

- [ ] Discord shows "Listening to Music App": that's the name of the app on Discord's developer portal (rename it there).
- [ ] Trademark search for Legato (INPI, EUIPO, USPTO classes 9, 41, 42).
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).
- [ ] Spotify: try Ctrl+A, Ctrl+C on a private playlist in the desktop app and paste into Notepad (links, one per line?).
- [ ] Spotify: ask for the data export (Privacy settings › Download your data); its `Playlist1.json` is the test file:
      open the ZIP in Add music › Connect Spotify › Open Spotify's data export (are private playlists in it?).
- [ ] A playlist file from foobar2000 / VLC / MusicBee, and an `iTunes Music Library.xml`, through Add music.
- [ ] Quit the installed Legato from the tray and open it again: a session closed its hidden single-instance window by
      mistake on 2026-10-31.

## Not done yet

**Spotify** (no keys; the user chose link import)
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- Dependabot alert #1 (`glib` 0.18, Linux only, through Tauri's GTK3 stack) dismissed: re-check at each Tauri upgrade.

## Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
- No circumventing Premium or DRM. Quotas respected, no server of ours.
