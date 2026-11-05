# Legato: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign, the product pass, roadmap milestones 0 to 2, the user's choices along the
way) is in git: `git log -p docs/notes/plan-v2.md`, and in the release notes.

Stable: v1.1.681 (2026-11-05). Next: Against Liner's quick wins, then milestone 3, Platforms. Where the work stands:
[handoff.md](handoff.md).

Every idea here stays: the user wants them all built in the end, just later (user's choice 2026-10-31). The roadmap sets
the order; a line leaves only when it ships or the user drops it.

## Website

- [x] `M` Home page as a scroll story (user's choice 2026-10-31): the real interface in a 3D window (`site/demo`), eight
      chapters, the visitor takes it at the end; audit of the page's slop (`docs/design.md` › Website). Local, not
      published.
- [x] `S` Publish it with the next Stable (user's choice 2026-10-31). Done earlier, on the owner's word (2026-11-01): Beta
      1.1.557 out, Stable still 1.1.479, so the site shows a few things Stable hasn't yet (Connect Spotify, the import
      screen). Branch `claude/site-scroll-3d-aff654` merged into `platforms` with `[skip release]`, then master; its cards
      and chapters took platforms' new copy (radios and the Auto-DJ in the Mixes card, ListenBrainz, Ctrl+K, the column
      browser, word-by-word lyrics). Not tried on a weak PC, in Firefox or Safari. Pages builds the demo on Linux now: a
      red run leaves the old site up.

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
| 5 | Your own music (1.4) | Jellyfin / Navidrome / Subsonic, ReplayGain, batch tag editor + MusicBrainz, ratings, column view, ListenBrainz, playlist folders | L | MusicBee / foobar / Plexamp users switch for this |
| 6 | Smart (1.5) | Local sonic analysis, song / artist radio, sweet fades, path between artists, auto-DJ, smart shuffle, Wrapped | L | What no free desktop app does without a server |
| 7 | Around the house (1.6) | ~~Phone remote~~ (done 2026-11-02), cast (DLNA / Chromecast), listen together on the LAN, pick up on the other PC | L | Turns a player into a home system |
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

Built in this order, easiest first (the owner's ask 2026-11-05: all of them, by difficulty). Never copied: their
playback (YouTube's audio taken, their own copies, downloads for offline), their accounts, limits and paid plan.

- [x] 1. `S` Keep the screen on while music plays (a setting, off): the wake lock the Cover display already takes.
      (2026-11-05: Settings › Playback › Screen, `keepScreenOn`, this PC only; `shared/awake.ts` shared with the Cover
      display. In the demo a stand-in lock is taken on Play, let go on Pause, never with the setting off; the browser
      pane refuses a real one, so WebView2's own grant is unchecked: Check live.)
- [ ] 2. `S` The artist's bio on the artist page: YouTube Music's own "About" text, Read more.
- [ ] 3. `S` Discord on par: a status format (song, artist, both), the artist's picture, a preview.
- [ ] 4. `S` The mini player on minimize (a setting, off): picture in picture opens, restoring closes it, the sung line
      in it; YouTube's 200 × 200.
- [ ] 5. `S` Settings › Storage: what the app keeps on disk (library, covers, lyrics, logs, WebView2's cache), the size
      of each, a Clear for what can go.
- [ ] 6. `S` A native window on Windows 11: snap layouts on our maximize button (`WM_NCHITTEST` → `HTMAXBUTTON`,
      beside `thumbbar.rs`), Windows' minimize and maximize animations.
- [ ] 7. `S` A profile card without an account: top artists, the recap, a few playlists, as a picture (a link with 11).
- [ ] 8. `S` Motion polish, for the owner's eye: play / pause morphing, a like's pop, pages fading in; none with reduced
      motion.
- [ ] 9. `S-M` Check the matches after an import: doubtful ones with their candidates, pick or keep, approve all.
- [ ] 10. `S-M` Fast start on a skip: time to sound measured, then the next YouTube video cued in the crossfade's player.
- [ ] 11. `S-M` Share links that open in any browser: a static page on the website reads the playlist from the link's
      fragment, Open in Legato, Listen on YouTube, Get Legato.
- [ ] 12. `S-M` A moving cover background (our own WebGL shader): Now Playing, Karaoke, the Cover display, behind Home
      as an option; under 3 % CPU.
- [ ] 13. `M` Imports in seconds: the playlist there at once, each song looked up as it comes up to play, the rest at the
      slow pace (never more searches, never quicker: `searchpace`).
- [ ] 14. `M` More lyrics sources and a picker with a match %, each source's terms read first, a privacy row each.
- [ ] 15. `M` SoundCloud sets and likes through its official widget's list (terms first), matched on YouTube.
- [ ] 16. `M` Reach: the website in the app's 18 languages, README screenshots, winget and Scoop, Discussions (outward
      steps: the owner's word). Takes in Features › Low's Community line.
- [ ] 17. `L` Listening rooms over the internet, no server of ours: sealed control messages through a public relay (the
      owner's call), or the LAN. Takes in "Listen together on the local network".
- [ ] 18. `L` A Linux build (AppImage, deb): WebKitGTK, the MPRIS media panel, the tray, PipeWire for the detector.
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

- [x] `M-L` Connect Spotify, the friendly way (user's go 2026-10-31, `docs/playback.md`): a button opens Spotify's sign-in
      page in an app window, Legato lists the playlists and Liked Songs with their covers, the user ticks some, Import,
      progress; a second import refreshes. Tried on the user's real account in the dev app (a page in French, 21 playlists +
      Liked Songs, 244 of 244 read, Cancel, a second import).
- [ ] `S` Connect Spotify, not tried yet: playlists inside a library folder, a collapsed library column, an expired
      session, the window covering Legato while it reads (Cancel in the toast may be behind it), a list with local files.
- [x] `M` Spotify, instant and no scraping (user's ask 2026-10-31): Connect Spotify drives
      [Exportify](https://github.com/watsonbox/exportify) in an app window (official API after Spotify's consent page, in the
      browser, open source) and every list comes straight in, no file to see (`docs/playback.md`, why not our own copy too).
      Tried on the user's real account in the dev app. Spotify's page stays as the second way.
- [ ] `M` Likes and adds sent to Spotify (Send only, Both ways): official API only, so a key and a Premium account, also
      to test it. No way without them: Exportify only reads, and pressing hearts in Spotify's page would be a bot on the account.
- [x] `S` Exportify failing says so (user's go 2026-10-31): its window is watched, site down, page changed, reading stalled,
      access refused all end in a dialog with Try again and the page route. Its own copy can't remove the dependency: the key
      is what counts (`docs/playback.md`). Stalled and a real refusal on Spotify's page not seen live, signal path checked.
- [x] `S` Nothing leaves you on Spotify's page (user's report 2026-10-31): Settings › Accounts offers Import my lists beside
      Open, which only plays, and a sign-in left on Spotify's own pages returns to Exportify.
- [x] `M` Import quicker and shown properly (user's ask 2026-10-31): songs the library knows aren't searched, 8 searches in a
      sliding window, an import screen with covers landing on a deck instead of a toast.
- [x] `M` Import's real limit is Google (user's ask 2026-10-31, measured: 2142 songs in about 13 min, then anonymous searches
      refused with its "Sorry…" page): lists saved first, one search per unknown song, a refusal waits instead of counting as
      not found (`searchpace`), time left on the screen. Not measured yet: a real run of this version; its log line says how
      many searches were refused.
- [x] `M` Songs not found kept and shown (user's ask 2026-10-31): searched and truly missing, skipped by imports for 30 days,
      a page in the sidebar to read them, find one by hand, or search them all again. Not tried on a real search yet.
- [x] `S` A version found by hand stays a separate row: Find this song now opens the search in a pick mode (a banner,
      Use this version on each result); the pick joins the song's own row (`Library::set_version`, a library song merges
      in), so its playlists play it and it leaves the list. Not tried in the real app yet.
- [x] `M` Import under YouTube's limit (user's ask 2026-10-31): a line for the time left, one for the limit with its countdown,
      held-back time counted in the estimate, one search settling every song in line it brought back. Measured on an address
      already limited: 44 searches, then blocked 5 min, then about one every 15 s. The gain from `Line` isn't measured yet.
- [x] `S` Exportify's file names are lowered, with underscores ("Cool music" for "Cool Music"): the real names now come
      from its progress bar as it exports ("Exporting Cool Music...", any language: `exportify.js` sends each line, the
      cut most lines agree on gives the names, matched to the files by Exportify's own file-name rule,
      `spotify_export::name_lists`). Spotify's data export ids follow that rule too. Its playlist column
      ([exportify#194](https://github.com/watsonbox/exportify/issues/194)) would be simpler. Not seen on the real page
      yet (the owner's account).
- [x] `S` Spotify's `spotify_export::list` drops local files (8 in the user's export): they come as songs to find, named
      from their columns or their form-encoded URI, searched on YouTube. Not tried on the user's export yet.
- [x] `S` Spotify's "private or doesn't exist" message says what works instead: Connect Spotify, in the user's language
      (`shared/errors.ts`; an album says removed or not in the country).
- [x] `S` A Legato link brings its videos (user's ask 2026-10-31): share code version 2, each YouTube entry with the
      sender's artist, title and length, taken as is (no oEmbed, no search); version 1 codes still read, QR codes stay ids
      only. Its import runs on the import screen, covers landing; artist + title entries searched at YouTube's pace.
      Not tried between two PCs yet.
- [x] `S` YouTube Music every 15 minutes (user's ask 2026-10-31): an option, off by default, offered after each Google
      sign-in and in Settings › Accounts; a refusal from Google waits 30 min, silently. Not tried in the real app yet.
- [x] `M` Connect Apple Music, like Spotify's page (user's choice 2026-10-31, against Apple's terms: the app says so
      first): Apple's own page in a window, signed in there, its playlists read (`apple.js`, checked by
      `connectors::apple_page`, shell `apple_web.rs`), ticked, then the import screen. No developer account, no token.
      Song rows checked on a public playlist page; the signed-in pages (All Playlists, a library playlist) and the
      media-user-token cookie not seen yet: needs the user's account.
- [x] `S` Playlists in and out as files: M3U / M3U8 / XSPF / CSV import and export (paths for local, links for streams).
      In: Add music › Import a list of songs › Open a file (`music_core::playfile`): a library file comes as it is, a
      YouTube link with names too (without: oEmbed), the rest searched by name; the list's own name kept. Out: a
      playlist's menu › Save as file. Not tried in the real app yet (a foobar2000 / VLC / MusicBee file is the test).
- [x] `M` Spotify private playlists and Liked Songs by paste, free, no sign-in: Ctrl+A then Ctrl+C in Spotify's desktop app
      copies `open.spotify.com/track/…` lines (a Spotify community moderator's guide; try it on the user's PC first).
      Legato takes those lines in Add music, names each song from its public embed page (title, artists, duration: checked
      on a real track, `spotify_embed.rs` reads playlists and albums only today) and imports through the usual matching.
      Also passes the embed's 100-song limit on public playlists. One request per song: few at a time, with retries (one
      real request gave a 504). The safe route beside Connect Spotify, guided: Add music › Spotify shows the two keys and
      catches the copy by itself, no paste box.
      Done: the paste box of Add music › Import a list of songs takes those links (`src-tauri/src/spotify_paste.rs`):
      each named from its embed page (`spotify_embed::track`, its format checked on a real track 2026-11-01), 4 at a
      time with one retry, then the import screen; a playlist of yours. Not done: the guided route that catches the copy
      by itself, and the 100-song limit of public playlists. Not tried with a real copy from Spotify's app yet.
- [x] `S-M` Spotify's data export (Privacy settings › Download your data): open the zip or `Playlist1.json` in Add music,
      each playlist comes in under its name. Official and free; takes days to arrive. Done: Connect Spotify's card ›
      Open Spotify's data export (ZIP, `Playlist*.json`, `YourLibrary.json` = Liked Songs; an Exportify file too), the
      lists ticked, then Exportify's import. A list keeps Exportify's id, so either route refreshes it and the export
      brings the real name. Written from the format as documented: not tried on a real export yet, and whether private
      playlists are in it is still unconfirmed.
- [x] `M` Paste a SoundCloud link: a song's link (soundcloud.com, m., the app's on.soundcloud.com short links, a private
      song's secret link) is named by SoundCloud's public oEmbed (`connectors::soundcloud`), then found on YouTube and
      added like a YouTube link (`add_link`, paste anywhere, the welcome, search); not found says so, nothing plays from
      SoundCloud. A set's songs aren't read: oEmbed names only the set and its list needs the API (a registered app,
      scraping barred), so the app says it plainly. oEmbed checked on SoundCloud's own example (a song, a set); short
      links written from their redirect, not tried on a real one.
- [x] `M` Import from other apps: the iTunes / MusicBee library file (`iTunes Music Library.xml`, `music_core::itunes_xml`):
      Add music › From iTunes or MusicBee, its playlists ticked (smart ones unticked; the whole library, its parts,
      folders left out), then the import screen. A song the library has as a file comes as it is, the rest is found on
      YouTube at its pace; each list becomes a playlist of yours. Not tried on a real file yet.
- [x] `S` Onboarding: Spotify / YouTube likes in one go, from the welcome. Connect Spotify sits beside YouTube Music in its
      cards (Home's too, while the library is empty), and its import screen takes over from the welcome. A dialog opened
      inside another gets the keys and the whole window (`.dialog-in` fills backwards). Not tried from the welcome with a
      real account yet.
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
- [x] `S` Drag files or folders from Explorer onto the window: a folder joins the watched ones, an audio file outside them
      is kept on its own (setting `files`, scanned with the folders: `local::take_drop`, `folders::add_dropped`), then
      one rescan. Songs new to the library wait for the notice's Play; songs it had play at once. Shift can't be read
      during an OS drop (the window has no key events then): the notice's button instead. A file kept on its own goes
      with Remove from library; Settings lists only the folders. Not tried with a real drop yet.
- [x] `S` Gapless + crossfade that knows albums: Settings › Playback › No fade within an album (on by default). The next
      song right after this one in the list, same album and first artist (`fade.ts` `albumGoesOn`, as Albums groups
      them), plays on with no fade out, overlap or fade in (`songFade` in the store; the local engine's gapless move
      too). No track numbers kept: the list's order stands for the album's, a compilation still fades. Detecting a
      continuous boundary from the sound (any album) is not done.
- [x] `S` Artist / album / playlist radio and endless autoplay: Start radio on any set of songs (an album's, an artist's
      or a selection's menu, a playlist's menu, the artist page's Radio). Its most played song first, then YouTube Music's
      radio of it (signed in) or library songs that fit, its own songs one in three (`radio.ts` `startRadioFrom`, pure
      parts `radioMix.ts`). A radio is endless: songs like the last few come as Up next runs out, autoplay setting on or
      off (`radio` in the player store). Up next says "Then from Animals radio".
- [x] `S` Playlist folders, pinned playlists, generated playlist covers (a 2×2 of the songs' covers). Covers were there
      (right-click › Cover › grid of 4). A playlist's menu: Pin to top, Move to folder (its folders, New folder…);
      the sidebar's + makes a folder too. Pinned ones on top, then folders (open or closed, their playlists indented),
      then the others, each part in the order picked (`sidebar/arrange.ts`; settings `pinnedPlaylists`,
      `playlistFolders`, keyed by `playlistKey`). A folder's menu: play its playlists' songs, radio, rename, delete
      (its playlists stay, the notice's Undo). Driven in the interface alone (fake Tauri), not in the app.
- [x] `S` Backup / restore the whole library to one file (playlists, likes, edits, stats), outside Sync Mode: Settings ›
      General › Library backup. A `.legato` file is the library's consistent copy (`VACUUM INTO`, its own read
      connection, like the daily copy); a restore checks it's a library this version knows, keeps the current one as
      `library-before-restore.db`, copies the backup in page by page (SQLite's backup API), then restarts the app (an
      older backup migrates at that open). Sign-ins stay in the keychain, out of the file. Not tried in the real app yet.
- [x] `S` Smart shuffle (skips recently played, spreads artists): `player/shuffle.ts`, each artist's songs spread
      through the queue, no artist twice in a row while others are left, songs heard in the last day after the
      others. Settings › Playback › Up next, on by default (off: plain random).
- [x] `S` "Daylist"-style mixes by time of day. Already there: "Your evenings" (this time of day) and "Your Fridays"
      (this weekday). Added: "Your Friday evenings" (`crates/core` `mixes.rs` id `daylist`), this weekday's time of day
      from two past weeks at least, first in its section; it changes through the day and the week (the page reloads
      its mixes on each visit). A plainer mix with the same songs steps aside.
- [x] `S-M` Command palette (Ctrl+K): any song, page, setting or action in one box. The search bar's list (Ctrl+K
      already focused it) gains "Pages, actions and settings": every page, every action of `app/keys.ts` with its keys
      (run by `RUN`), every row of the settings index (opened and highlighted). `search/commands.ts` ranks them
      (label start, label words, keywords; English and the interface's language; CJK by substring), `commandList.ts`
      builds them. "sleep 30"-style arguments are not done.
- [x] `S` Search, better (the owner's ask, 2026-11-05): your songs by how well they fit, no longer in library order
      (a word in the title counts most, then in the artist, then in the album; the title being the text or starting
      with it more; a title or artist named only by words typed too, "adele hello"; then the most played). Marks
      ignored ("dont" finds Don't, "acdc" AC/DC, & and + read "and"). Nothing found as typed: each word found
      nowhere swapped for the library's closest one, a line says so. The top result is your artist only when its
      name is the text or starts with it (as much as the best song's title does). `search/match.ts`, also the library
      pages' filter, each song's names made once (no fold per song per key). Seen in the demo ("harbor": Harbour
      Master on top). Decided alone: the weights, one letter off (two from 8 letters). Unseen: 50 000 songs typed.
- [x] `S` Pause when headphones are unplugged or Bluetooth drops: `src-tauri/src/unplug.rs` (Windows' endpoint
      notifications: the default output leaving) → `features/player/unplug.ts` pauses at once (no pause fade), notice
      with Play; Settings › Playback › Headphones and calls, on by default. Unseen: headphones and speakers on one endpoint
      (Realtek jack retasking).
- [x] `S` Pause during a call (Windows' communication ducking): `unplug.rs` registers for the default output's ducking
      notifications (every session's) → `audio-call`; `unplug.ts` pauses (with the pause fade) and plays on when the
      call ends, unless the music was played or changed meanwhile. Off by default: Windows already lowers it.
- [ ] `S-M` Same loudness across sources: YouTube vs local vs Spotify levelled by the Adaptive Sound meter.
- [x] `M` Word-by-word lyrics when the source has them (enhanced LRC), background vocals apart, Apple-style animated lines
      (Cider, Spicetify's Beautiful Lyrics). Word times from LRCLIB's Lyricsfile (YAML, read with `serde-saphyr` and
      its limits, kept only when the record says `hasWordSync`) or an LRC's `<mm:ss.xx>` stamps (`music_core::lyrics`);
      a word-synced record wins over a closer length; the panel and Karaoke fill each word at its own time (the
      line's time shared by length otherwise, as before). Stretched for slowed versions, moved by the tapped fix.
      Signed in to YouTube Music, its timed lines still come first (no words, but LRCLIB isn't asked then).
      Background vocals apart: not done, the Lyricsfile has no role for them (its overlapping lines play one after
      the other). Unseen: a real word-synced song (LRCLIB was overloaded when checked; few records have words).
- [x] `M` ReplayGain / loudness normalisation for local files (reads the tags, or measures once and stores it).
      Settings › Playback › Volume levelling (Off / Song / Album, off by default): a gain to -14 LUFS (the streaming
      level, so local songs sit with streamed ones), from ReplayGain tags (+4 dB) or BS.1770-4 measured once in the
      silence scan's decode (`music_dsp::loudness`, SQLite `loudness`), applied before the live chain, peak-safe. Album
      without tags = the song's gain. See docs/playback.md › Local files. Unseen: real tagged files, by ear beside
      YouTube; off by default until the owner tries it (worth turning on by default then?).
- [x] `M` Phone remote: a page served on the LAN (QR code) to pause, skip, see the queue (Plexamp-like). Settings › Playback, off by default, per PC; `src-tauri/src/remote.rs` + `remote.html`, pure part `crates/core/src/remote.rs`, `features/remote/`.
- [ ] `M` Accessibility pass: full keyboard, screen reader labels, contrast AA everywhere, reduced motion.
- [x] `M` Library health: missing files, YouTube videos gone private (with "Find another version", `alternative_videos`),
      songs without covers or tags, one page to fix them. Settings › General › Library health, or the search bar:
      Files gone (songs a playlist still holds whose file vanished, `Library::sourceless`), Can't play (videos the watch
      page said can't play, on this PC: `features/library/broken.ts`), No cover (local files with no picture inside,
      read at each visit: `health.rs`), Missing info (local files without artist or album); Songs not found and
      Duplicates linked. Find this song (pick mode), Edit song info (one or all). Not done: checking every YouTube
      video ahead (a request per video to Google: the owner's call). Unseen in the real app.
- [ ] `L` Personal servers: Jellyfin, Navidrome / Subsonic, Plex (the user's own music, streamed legally, keychain login).
- [ ] `L` macOS and Linux builds (media panel, detector, tray per OS).
- [ ] `L+` Mobile version, well optimised, the Rust code reused (the owner's ask 2026-11-02): Tauri 2's Android target
      with the same crates and `ui/`, Android first, iPhone after. Spec, seven phases, what stays desktop-only and the
      owner's calls (Android SDK / NDK on this PC, a phone, GitHub or Play Store, YouTube sign-in in a WebView):
      [ideas/mobile.md](ideas/mobile.md). Phase 1, the phone layout in `ui/`, done 2026-11-02; phase 2 needs the owner's
      Android tools.
      The owner's ask of 2026-11-02 (afternoon): the mobile app working completely, synced with the PCs over Wi-Fi
      both ways, then a Beta with the APK. Choices: alone until 95 % of the week, workflows after the reset (one agent
      at a time, effort high, under 30 % of the 5-hour window); Android first, the iPhone once the owner picks its
      signing; Android SDK / NDK / JDK 17 on this PC (the owner's OK) to test on an emulator; YouTube signed out on the
      phone, the library from the PC by sync.
  - [x] Spec of the devices sync: [sync-mode.md](../sync-mode.md) › Your devices on the same network.
  - [x] Core: kinds, the QR link, who starts (`crates/core` `devices.rs`).
  - [x] Wire: pairing, trusted sync, presence (`crates/connectors` `devices.rs`).
  - [x] Shell: listener, presence, auto-sync, keychain, commands (`src-tauri` `devices.rs`).
  - [x] Settings › Sync Mode: the devices list (icons, here or not), Add a device (code, QR), trust, sync automatically.
        (2026-11-02: unit-tested and type-checked, seen in the demo at phone width with invented devices; never run
        between two real devices, nor seen in the real app.)
  - [x] Android tools on this PC (2026-11-02): `C:\dev\android` (Microsoft JDK 17.0.21 zip, SDK command-line tools 23,
        platform 36, build-tools 37.0.0, NDK r30 30.0.16248370, emulator + an API 36 Google APIs x86_64 image) and
        Rust's four Android targets. Nothing persistent: dot-source `C:\dev\android\env.ps1` (JAVA_HOME, ANDROID_HOME,
        NDK_HOME). Checked: a hello-world built for ARM64 by NDK r30.
  - [x] Android, first run (2026-11-02): Tauri's Android project, rustls on Android, desktop-only parts gated, the
        multicast lock, the phone's name; a debug APK starts on the emulator with the phone layout.
  - [x] Android release APK (2026-11-02): arm64, signed from a local keystore (`keystore.properties`, out of git),
        secrets in a private file on the phone (`secrets::FileStore`); starts on the emulator, sent to the owner.
  - [x] Android in every Beta (2026-11-02): `release.yml` builds and signs the APK (Actions secrets
        `ANDROID_KEYSTORE` + `ANDROID_KEYSTORE_PASSWORD`) and attaches it to the release; the welcome, About, Privacy
        and the player bar say phone instead of PC on the phone.
  - [x] Android: the music goes on when the app leaves the screen, like YouTube Premium (the owner's request,
        2026-11-03; against YouTube's terms, said): a `mediaPlayback` foreground service while it plays, the WebView
        kept awake and YouTube's frames told they're visible. Try it on the owner's phone.
  - [x] Android: previous / play-pause / next in the notification and on the lock screen (a MediaSession fed by the page
        through a web message listener limited to the app's own origin), Back on Android 8 to 11 goes to the background
        (2026-11-04). Starts on the emulator; the buttons and a real song not tried. The song's cover there too
        (2026-11-04): the page reads its 256 px thumbnail back through a canvas and posts it after the state; seen on
        the emulator with a title pushed by hand, a real song's path not driven.
  - [x] Android: the music really plays on behind other apps and with the screen off (2026-11-04, the owner's report on
        1.1.621: it stopped). Chromium pauses a hidden page's videos itself: the WebView sits in a frame that keeps its
        window shown (`MainActivity.setContentView`, `KeepVisible`); the CPU and the Wi-Fi stay awake while a song plays
        (`PlaybackService.hold`); Back always sends the app behind (from Android 12 it closed it unless opened from the
        home screen, and Tauri quits with it). On the emulator: 60 s behind Home, a song change screen off, 60 s of
        forced Doze, Back. Swiping the app away from the recent apps still stops the music.
  - [x] Android: no cut in the music as the app leaves the screen or the phone sleeps (the owner's report, 2026-11-04:
        « un petit délai »). wry paused the WebView in `onPause` and ours resumed it at once, but Chromium had already
        paused YouTube's video: `pause` then `play` 0.3 to 0.8 s apart, plus a stall of the player (3 s on the
        emulator). wry's own field for its WebView is now emptied once it's made (found by type, kept by
        `proguard-rules.pro`), so wry never pauses it; Back goes through our own callback (the page's history, then
        behind). On the emulator: no `pause` / `play` event and time running on with Home, the screen off, Back. The
        release APK (R8) keeps the field (`apkanalyzer dex packages`), not run on the emulator; not heard on a real
        phone.
  - [x] Device sync carries every setting (2026-11-04): a PC with one stamped setting never stamped the rest, so they
        travelled as time 0 and no device took them; any unstamped key counts now, and more per-device keys stay local.
        Unit-tested, not tried between two real devices. Desktop-only rows and Shortcuts hidden on the phone.
  - [x] The phone's wording for the texts that said PC (2026-11-04): Stats, Mixes, search history, cover cache, offline
        notice, Sync Mode's shared-folder card hidden. Then (2026-11-04) Sync Mode's lines, Accounts (Google refuses
        sign-ins inside phone apps: the phone says to sign in on the PC, its playlists come by sync), Last.fm and
        ListenBrainz removal, backups, theme pictures, diagnostics; the Music Detector listens to the microphone only
        (no PC sound to take). Then the paste hint (no Ctrl+V outside a field: a YouTube link in the search box is added
        now, like a SoundCloud one) and the shared-playlist card; Discord stays off on phones (Add-ons are hidden there,
        the switch still comes by sync). Left: the OneDrive prompt (unreachable there), plugins (desktop only).
  - [x] Music Detector on the phone (2026-11-04): `RECORD_AUDIO`, Android's dialog at the first listen (after Legato's
        own consent), a refusal says where to allow it with an Open app info button. On the emulator: the dialog, the
        refusal's note and button, the app info page, then a one-time grant: Android's mic indicator lit, the level
        moving bar, Stop (nothing sent). A real song not recognized (the emulator's microphone is silent).
  - [x] The interface's texts and layout at every size (the owner, 2026-11-04: « faudrait vrm bien gérer les ui et leur
        texte et le responsive »). Done, seen in the demo at 375 × 812, 800 × 600 and 1100 × 700: the phone's Songs
        rows and toolbar, Home (search box, shortcut tiles, section heads), a list's toolbar and search scope, Mixes,
        Stats, Now Playing's top bar, every Settings section (rows wrap in a narrow pane by a container query, Accounts
        one line per service, the phone says phone: language, accent, font). A window under 1200 px: the right panel
        steps aside (its mini player floats, Lyrics / Up next open Now Playing), the song list drops its least needed
        columns to fit (`fitColumns`). Then the phone's search results (chips in one sideways row, rows without
        sources and time) and the album / artist song rows (title room, a tap plays). Then on the emulator (API 36, 411 px):
        Android's own scrollbars (a styled one stayed on screen and took 10 px of the page), the paste field's short
        hint, and what can't work on a phone replaced by a From your PC card (Add a device): Google's, Spotify's and
        Apple's sign-in windows (Exportify's page covered the app with no way back) and the folder picker (none on
        Android); Accounts' Spotify web player and Local files rows hidden there. Not seen on a real phone, nor at 360 px
        (two of Settings' choice rows scroll sideways under 390 px).
  - [x] `M` Android: files picked or saved through Android's own picker. It gives `content://` addresses, and every
        command reads or writes a path: song lists, Spotify's export, iTunes files, pictures (theme, covers), backups,
        themes, exports and reports all failed on the phone. Done (2026-11-04): `shared/files.ts` (`pickFile`,
        `saveFile`) for every file dialog; a picked address is copied into the cache, a saved file written there and
        copied out (`src-tauri/src/picked.rs`, `PickedFile.kt` over JNI); on the phone the picker filters by media
        types only (a .theme or .legato file has no type Android knows). Seen on the emulator (API 36): a theme saved to Downloads through Android's save screen, then opened back from it (copied in under its own name); the other dialogs not driven one by one, nor a real phone.
  - [x] `M` Android: music on this phone (local files). No folder picker on Android (`tauri-plugin-dialog`
        refuses folders on mobile): `READ_MEDIA_AUDIO` and a scan of the phone's Music and Download folders, played by
        the Rust engine in the background with the notification (docs/notes/ideas/mobile.md, phase 3). Done
        (2026-11-04): a Music on this phone card (Add music, the welcome) and the Local files row ask Android's
        permission (`READ_MEDIA_AUDIO`; 8 to 12: `READ_EXTERNAL_STORAGE`) through MainActivity's `LegatoMusic`, then
        watch the phone's Music and Download folders like a PC's; scanned again at launch while Android still lets
        Legato read them (`features/add/phoneMusic.ts`). Seen on the emulator (API 36): the dialog and a refusal (its
        note, Legato's app info), a WAV found with its tags, a file pushed later found by the watcher, played by the
        Rust engine behind other apps and with the screen off, the notification with its title. Not seen on a real
        phone, nor Android 8 to 12, nor an SD card (not looked at).
  - [x] QR scanner for pairing (2026-11-04, `tauri-plugin-barcode-scanner` 2.x): never scanned a real code.
  - [x] Secrets sealed by Android's Keystore (2026-11-04), moved once from `secrets.json`: checked on the emulator.
  - [x] Android download on the website (2026-11-04): hero link and FAQ; a push deploys it (the owner's call).
  - [x] Beta with the APK (CI builds and signs it): 1.1.679, 2026-11-05.
  - [x] Android updates in the app (2026-11-05, the owner's « Oui, ajoute-la »): Beta's `latest.json` checked 5 s after
        launch and every 6 hours (release builds), a toast « Legato {version} est disponible » with Update, and
        Settings › About's Download update / Install update. The APK downloads only on a tap, into the cache, then goes to
        Android's installer, which asks (the first time, Android's "Install unknown apps" page, then the installer as
        Legato comes back; ready while Legato is off screen, it waits for its return). The new version's first launch
        resumes as it was (`just_updated`). Decided alone: the phone follows Beta (only Betas carry an APK); never a
        download unasked (mobile data); `REQUEST_INSTALL_PACKAGES`, which the Play Store forbids (to drop if Legato goes
        there). Android refuses an APK not signed with the installed app's key. Phones on 1.1.679 or older install the
        next APK by hand, once. About's header lets its button go under the text on a phone. Seen on the emulator (a
        debug x86_64 build, API 36): Check now found 1.1.679 and its APK on GitHub, the toast and Download update, the
        download into the cache, Android's "Install unknown apps" page, then its installer as Legato came back; Cancel
        left it ready (Install update opens it again); asked behind Home, the installer waited for Legato's return;
        Android refused the release APK over the debug app (another key), as it should. Not seen: an update really
        installing and the new version resuming (the next Beta on a phone), a release build's background check.
  - [x] Release notes in full (2026-11-05, the owner's « dans les update logs on mettra tout … added: fixed:
        performance improved »): every feat / fix / perf line, under Added, Fixed and Performance improved
        (`scripts/notes.mjs`, betas and promote alike), the headers in the user's language; old notes (New, Faster,
        "And N more") still read. Versions before it show the new headers in English.
  - [x] Stable 1.1.681 (2026-11-05, the owner's « push cette version en stable si tout les check passe et update les
        stats d'optimisation du site »): promoted after its checks and the next push's were green; the website's and
        the README's numbers from a new bench (`docs/performance.md`, row 2026-11-05: the cold start quoted is the
        middle of three runs, the full run's was the odd one out).
  - [ ] iPhone: waits for the owner's signing choice (Apple Developer Program, or an unsigned .ipa).

**Medium**
- [x] `S` Find a song by a line of its lyrics (LRCLIB search), and hum to search if AudD's free tier allows it.
      (2026-11-05: neither service can. LRCLIB's search, v1 and v2 beta, looks in title, artist and album only (its docs
      read that day); AudD's docs list file, stream and enterprise recognition, no humming. Built instead, local: the
      search page's "In the lyrics" finds your songs whose lyrics, cached when they were shown, hold the text (5 letters
      at least, from a word's start, across line breaks, accents and punctuation aside), with the line it starts on;
      `music_core::lyrics::line_holding`, `Library::lyrics_search`, command `search_lyrics`. YouTube Music's own search
      already matches lyric lines when you search everywhere. Decided alone: library songs only (a cached song not in the
      library has no source to play), 50 at most, lyrics from a song's own file not searched (not cached). Tried: Rust
      tests, the demo's search page. Not tried: a real library's cache.)
      Owner's call (2026-11-01): LRCLIB's search (`q`) matches titles, artists and albums, not the words, so it can't
      find a song by a line. A source that does (Genius' search with the user's own token, Musixmatch) is a new
      service and a privacy row. Worth trying first by hand: a line typed in the search box, since YouTube Music's own
      search matches lyrics. AudD's humming terms not checked.
- [x] `S` Jump List (recent playlists, Shuffle all); thumbnail buttons already there (`thumbbar.rs`). (2026-11-05:
      right-click Legato on the taskbar: Shuffle all (a task), then Recent playlists, the 5 playlists opened lately that
      still exist (`src-tauri/src/jumplist.rs`, ICustomDestinationList; UI `features/home/jumpList.ts`, written again 2 s
      after the opened lists, a name or the language change). An entry starts legato.exe with `--jump shuffle` or
      `--jump playlist:<id>`; the ask waits in Rust until the interface takes it, at its start (closed app) or on the
      single instance's "jump" event (running app). A playlist entry opens its page and plays it from its start. Installed
      app only (Windows keeps the list outside the app's folders); an entry the user removed stays out. Decided alone:
      playlists only (no albums, artists or mixes), titles in the interface's language. Tried: Rust tests (arguments,
      entries), the COM part built. Not tried: an installed build's taskbar, so the list itself is unseen.)
- [x] `S` Auto-DJ that keeps the queue going from the library with rules (MusicBee). Songs' vinyl button, or Auto-DJ in an
      album, artist, playlist or folder's menu: ten picks, ten more as Up next runs out (`player/autoDj.ts`, pure picks
      `autoDjPick.ts`). Rules in Settings › Playback › Auto-DJ: a song heard lately waits (a week by default), ratings weigh
      (five stars 4×, one star ¼), an artist kept 3 songs apart; each gives way rather than stop. Not kept across a restart,
      like a radio.
- [x] `S` Scrobble to ListenBrainz too (open, no key), beside Last.fm.
      Settings › Accounts › ListenBrainz: the user token from listenbrainz.org › Settings, checked there
      (`/1/validate-token`), kept in the keychain. What plays now, and each listen (half of the song or 4 minutes heard,
      no 30 s floor) with its ISRC and the YouTube video or Spotify track it played from; offline or refused (429) it
      waits in memory for the next one, a 401 forgets the token (`connectors::listenbrainz`, mocked tests only). Not
      synced by Sync Mode, like Last.fm. Unseen: a real account.
- [ ] `S` Community: a Discord server or GitHub Discussions linked from About, "good first issue" labels, a showcase of
      themes on the website.
- [x] `S-M` Pick up on the other PC: Sync Mode carries "now playing + position", one click resumes there. (2026-11-02: the
  file's `now`; a toast once, then "Resume … from …" in the idle player bar.)
- [x] `S-M` Rating with stars or half stars (local and synced), smart playlists on it.
      Half stars in SQLite `track_ratings` (schema 16; 0 = taken off, kept with its time), carried with the play stats,
      Sync Mode's snapshot `ratings` (latest wins, older apps' files have none). A Rating column (off by default: lists
      › Columns; a star's left half = half a star, the same rating again takes it off, a slider for the keyboard), a
      Rating submenu on a song and in the player's menu, Alt+1…5 rate the song playing (Settings › Shortcuts), the
      Highest rated sort, smart playlist rule Rating at least / at most (rated songs only) / none yet and its sort.
      Not written into the files' tags (POPM / RATING): a choice for the owner, with the tag editor.
- [ ] `S-M` Discovery from open sources: new releases of followed artists, community picks (r/listentothis' public JSON),
      shown as cards to play from YouTube.
      Left by the autopilot (2026-11-05): new hosts and the website's privacy rows, and Reddit's API terms to read
      first: the owner's call.
- [x] `S-M` Privacy page in the app: every host Legato talked to today and why (from the Rust gateway's log), matching the
      website's rows. (2026-11-02: Settings › Privacy; `music_core::netlog`, fed by the connectors' resolver `Noted`, the
      WebView2 hook on every window, plugins' gateway, updates and the shield's lists. The updater's redirect to GitHub's
      file host is not seen.)
- [ ] `S-M` Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
      Left by the autopilot (2026-11-05): `watch.js` already hides the column the panel sits in (`#secondary`, `#below`)
      and pauses at the end; what's left needs a real watch page, behind YouTube's cookie choice in a new profile.
- [ ] `M` Lyrics translation in the panel (a service sends text: add the website's privacy row first).
      Owner's call (2026-11-01): which service gets the lyrics (the user's own DeepL or Google key, a LibreTranslate
      server); Windows gives apps no offline translator. The panel side is small once that's chosen.
- [x] `M` Tag editor (one file already: right-click › Edit song info, `src-tauri/src/tags.rs`): several files at once,
      track numbers, year, genre. Edit info of N songs in the menu of a selection, an album, an artist or a playlist
      (local songs only): album artist, genre, year, track and disc beside title, artist, album and cover; a field the
      songs share starts with its value, one that differs starts empty and stays as each file has it unless typed in;
      emptied = taken off; Number them 1 to N in this order (the list's order, N as the total). `read_tags` /
      `edit_tags` (`music_core::local` `file_tags` / `write_tags`), 5 000 songs at most, each file read back into the
      library. Unseen: real MP3 / FLAC / M4A files, a read-only or locked one, MusicBee or foobar2000 reading the year,
      genre and numbers.
- [ ] `M` MusicBrainz lookup that fills Edit song info (album, year, numbers from a release): a new host, the website's
      privacy row first.
- [ ] `M` Equalizer presets per output device (headphones vs speakers) and AutoEQ profiles for known headphones.
- [x] `M` "Wrapped": a yearly / monthly recap from our stats, shareable as a picture.
      (2026-11-05: Stats › Your recap, `features/stats/RecapView.tsx`, lazy. A year or a month with an hour of music at
      least (`recap.ts`, newest first, numbers from `statsOf` like Stats), as up to 7 cards (`recapCards.ts`): time, top
      artist, top songs, top album, a song for each month (a year), habits (the hour, best streak, new artists), a
      listening personality, the first rule that fits: on repeat, loyal, explorer, night owl, early bird, else eclectic,
      with the share behind it. Each card drawn as a 1080 × 1920 picture (`recapDraw.ts`: the cover's hue, the
      theme's font), copied or saved as PNG / JPEG through the share card's `save_picture`; ← → between cards, Esc
      back. Decided alone: called "Recap" (Wrapped is Spotify's word), on demand only (no December prompt), the
      personalities and their thresholds; the page header puts its actions under the title when both don't fit (the
      title was cut to "Your …") and wraps them on a phone; the share card's wrapping keeps no-break spaces. Seen in
      the demo, desktop and phone: the cards, covers, arrows. Unseen: a real save and copy in the app, a real year
      of plays, the APK.)
- [x] `M` Genre and year stored, local files (2026-11-05): read from their tags at each scan and after the song
      editor saves (`local::read_song`, as `file_tags` reads them), kept in `tracks` (schema v20) and given on
      `LibraryTrack` only. Shown as Year and Genre columns (Settings › Library columns; a narrow window drops them
      before the album), sorts by year both ways and genre (in the sort menu once a song has one), and a Genres pane
      before Artists in the column browser. Decided alone: kept off `Track` (every service's song), the year as a
      column and sorts rather than a pane, a song's first genre as written. Seen in the demo (its local songs got
      tags). Unseen: real tagged files in the app.
- [ ] `M` BPM / key tags; genre / year of streamed songs (Spotify's export has a release date; iTunes a genre);
      smart playlist rules on them (mixes, DJ-like transitions by BPM).
- [ ] `M` Mixes: genre / year tags (stored for local files only), Last.fm "Discoveries" (user's key); "Never in mixes"
      on a discovered song (not in the library: no row to hold the choice).
- [ ] `M` Internet radio stations (Radio Browser's open directory).
- [ ] `M` Release radar: new releases from artists in the library (YouTube Music / MusicBrainz).
- [ ] `M` Credits and artist pages: who wrote / produced (MusicBrainz), a short bio (Wikipedia), links out.
- [ ] `M` Sweet fades (Plexamp): crossfade length picked per pair from the songs' ends (loudness, silence, tempo).
      (Left by the autopilot (2026-11-05): a song's end is only known measured (local files, Skip silence on) or
      heard once (a video, `ends.ts`), its tempo not at all; the overlap is the player's most fixed code, and a
      length picked per pair needs an ear to tune: with the roadmap's Sonic analysis, or with the owner listening.)
- [x] `M` Picture-in-picture: the video or cover floating above other windows, small controls.
      (2026-11-05: P, the player bar's button or the player's menu. The same window made small and kept above the
      others (`src-tauri/src/pip.rs`: no second window, so no second player), 480 × 316 in the screen's bottom right
      corner the first time, then where it was left (settings `pipPlace`, this PC only, kept while a screen still
      shows it); back as it was (size, place, maximized, full screen) on Esc, its button or a double click on its
      strip, and before the app saves its place on quit. `features/player/pipMode.ts` + `PipScreen.tsx` (lazy): the
      video edge to edge (only its slot holds the embed then), or the cover over its blurred copy as Now Playing's
      Cover / Auto choose; a progress line and a strip (song, previous / play / next, back) under it, nothing over
      the video (YouTube's rule: toasts and the volume number wait); the picture and the strip drag the window, a
      click on the picture plays / pauses; its own right-click menu. Not from the full screens, not on the phone.
      Decided alone: the key P, the size (the picture stays YouTube's 200 px high at least: 356 × 246 the
      smallest), no double click on the picture (it already plays / pauses). Seen in the demo: the screen at
      480 × 316, P both ways, Esc, the menus. Unseen: the real window (small, above the others, dragged, back to a
      maximized or full screen one), a YouTube video in it, two screens. Left: Android's own picture-in-picture.)
- [ ] `M` Classic skins: a compact "mini" layout (Winamp-like) with the user's theme.
- [x] `M` A column view of the library with chosen columns, sorts and groupings (foobar2000, MusicBee). Columns and
      sorts were there (Display options, the headers); Songs › Display options (or Settings › Appearance) › Column
      browser, off by default: Artists and Albums panes above the list, grouped as the Albums and Artists pages group
      them, A to Z with their counts. A pick narrows the next pane and the list (the hidden videos' fold too), the
      search and the source chips narrow the panes; Ctrl / Shift pick several, arrows, letters jump to a name (the
      same letter again: the next one), Esc = All, double-click or Enter plays, right-click = the songs' menu, a drag
      takes them to a playlist (`features/library/browse.ts`, `ColumnBrowser.tsx`). A Genres pane first when a song
      has a genre (local files, 2026-11-05). Left: album groups in the list in track order. Unseen in the real app.
- [ ] `M` Long YouTube mixes and DJ sets split by their chapters (or timestamps in the description / pinned comment):
      each part a song in Up next, skip within the video; Music Detector names unlabelled parts on request.
- [x] Local files follow Windows' default output: a new default (picked, or the speakers taking over) gets the song at
      the same place, paused or not (`unplug.rs` watcher → engine `Command::Reopen`). WebView2 follows on its own.
- [ ] `M` Output devices: switch from the player bar, remember per device (volume, EQ preset).
- [ ] `M` Right-to-left languages (Arabic, Hebrew: mirrored layout) and community translations (Weblate), more languages.
- [ ] `M-L` Listen together on the local network: one PC leads, the others follow (Sync Mode's code, no server).
- [ ] `L` Cast: DLNA / UPnP speakers and Chromecast for local files and personal servers.
- [ ] `L` Sonic analysis, ours and local: features (tempo, key, energy, brightness, mood) computed from local files, and
      from what plays live for streams (the meter already listens; measured, not extracted), stored per song. Feeds
      "similar songs", song radio, sweet fades, the path between artists (Plexamp's Sonic Analysis needs a server).

**Low**
- [x] `S` Squiggly / waveform progress bar as a progress style choice. Settings › Appearance › Player › Progress bar,
      Wavy: the played part is a wave moving while the song plays (a CSS mask, `.wave-progress`; still when paused or with
      Animations off).
- [x] `S` Waveform progress bar for local files: their levels, read once by the engine and kept (YouTube gives none).
      (2026-11-05: Progress bar › Song’s shape, the line below.)
- [ ] `S` Focus / workout sessions: a timer, no-lyrics or high-BPM mix, a summary after. (Left by the autopilot
      (2026-11-05): no tempo or energy data yet, so no high-BPM mix: the roadmap's "Smarter listening" analysis first;
      the plain timer is the sleep timer.)
- [x] `S` Now-playing overlay for streamers (a local page OBS can show, the app's theme). (2026-11-02: Settings › Playback ›
      Streaming overlay, `/overlay` on the phone remote's server, 127.0.0.1 only when alone; OBS's Custom CSS restyles it.)
- [ ] `S` Hide explicit songs (a filter, YouTube Music's flag when there is one). (Left by the autopilot (2026-11-05):
      no explicit flag is stored. The sources give it (YouTube Music's E badge, Exportify's Explicit column, iTunes'
      `trackExplicitness`): a `Track` field, a schema step and three parsers, an `M`.)
- [x] `S` Bookmarks inside a song (a moment to come back to, a note), Spicetify's Bookmark. (2026-11-05: right-click the
      player › Bookmarks: Bookmark this moment, or with a note; the song's bookmarks go back there; Remove a bookmark.
      Ticks above the seek bar. SQLite `bookmarks` (schema 18), 50 a song (`player/bookmarks.ts`, `docs/playback.md`).
      Decided alone: library songs only, this PC only (not in Sync Mode), in the player's menu only (not on song rows),
      the moment = the last report (a quarter of a second behind at most). Tried: Rust test, the demo (added, listed, tick
      drawn). Not tried: a real library, the dev app.)
- [x] `S` Full cover display: the cover alone, huge, title and progress over it (Spicetify's Full App Display); a clock
      option, for a second screen. (2026-11-02: C or Now Playing's button; clock from its right-click or Settings ›
      Appearance › Player; keeps the display awake. Checked over the demo in four window shapes; not on a real second
      screen.)
- [x] `S` "Aural fixations": songs you played a lot at one time of your life, brought back (from our own history).
      (2026-11-02: the "Back to {month}" mix, `fixation` in `crates/core/src/mixes.rs`: 4+ full listens' worth in one
      month at least three months back, half of all its plays, at most one since; several such months, the day's seed
      picks one. Its songs leave Rediscover. In Your mixes on Home and Mixes › Explore. Unit test, and the card checked
      over the demo with a faked mix; real history needs a few months first.)
- [x] `S` Sleep timer "at the end of this album" ("this song" exists) and a fade over the last minutes. Done: End of this
  album stops after the album's last song in play order (the next one is from another album or none; no wrap, songs
  the queue passes over skipped), looked at again on each song and queue change; the timed fade lasts the last 3 minutes,
  pauses whatever plays when it ends, and a pause during it fades down from where it got to.
- [x] `S` Share a song as a picture card (cover, title, a lyric line, the theme's colours) for social apps. (2026-11-02:
      the player's right-click › Share as a picture…: `features/share/`, a 1080 × 1350 canvas, the cover's colours or the
      theme's, the lyric line playing or another; copied, or saved as PNG / JPEG by `save_picture`. Nothing is sent.
      Checked over the demo with a faked save; a real paste into a chat app not tried.)
- [ ] `S` Spotify previews. (Left by the autopilot (2026-11-05): the Web API stopped giving new apps the 30-second
      `preview_url` (November 2024); an embed's preview MP3 played outside Spotify's player is the owner's call.)
- [x] `S-M` Alarm: wake up with a playlist (fade in), works from the tray. (2026-11-05: Settings › Playback › Alarm, or
      the player's right-click › Alarm…: a time, days, a playlist from its first song or all your songs shuffled, a
      fade from silence over 0 to 15 min. Rust keeps the next ring (`alarm.rs`) and wakes the page in the tray
      (`docs/playback.md`). Decided alone: music already playing is left alone; over 10 minutes late (the PC slept) it
      is skipped, not rung; this PC only; desktop only (a phone needs Android's AlarmManager); the days row starts on
      Monday. Tried: Rust and Vitest tests, the demo (rows, a ring sent by hand). Not tried: a real ring from the tray
      on an installed build, a PC waking from sleep.)
- [x] `S-M` Cover colours beyond the surfaces: "Whole app in the cover's color" (`appTint`, `ambient.ts`) tints the surfaces
      with one average colour; a small palette for the accent and the selection is left (Theme Studio choice).
      (2026-11-05: Settings › Appearance › Accent color › Cover: the song in the player gives the accent, its cover's hue
      made vivid and 3:1 on the background (`vivid`, the visualizer's "Cover's color"); the theme's own while none is
      loaded or the cover is grey (`useCoverAccent` in `coverTint.ts`, `resolveTheme`'s `cover`). Decided alone: the
      accent only, the selection stays grey (`docs/design.md`: "selected" and "playing" never alike); a paused song
      counts. Tried: a unit test, the demo with a coloured cover's accent set by hand (the play button follows, the next
      song's grey cover gives the theme's back; the demo's own SVG covers read as grey). Not tried: real covers.)
- [ ] `S-M` Volume: a perceptual (dB) curve (it would make every saved volume louder or quieter; local and YouTube stay level
      because both are linear), and per-source volume memory (needs its own setting and a switch rule). (Left by the
      autopilot (2026-11-05): the curve moves every saved volume, and the switch rule is a taste: the owner's call.)
- [x] `S-M` Guest DJ-style picks between songs ("because you liked …"), local and explainable, no cloud.
      (2026-11-05: the Auto-DJ's picks say why in Up next, after the artist: "Because you liked “…”", "In your Liked
      Music", "You gave it 5 stars". Artists of a song in your Liked Music (the account's and yours) now come up twice
      as often, under "Your ratings count" (its text says so). `autoDjPick.ts` `likedArtists` / `djWhy` (only the
      rules' own boosts are given as reasons, nothing made up), `autoDj.ts` `useDjWhy`. Decided alone: the boost is 2,
      no new setting, no toast between songs (Up next shows it). Tried: unit tests, the demo (reasons drawn in Up next
      with 5-star songs; its own `playAt` wrapper replaces the queue, so the demo's Auto-DJ doesn't stay on: set by
      hand). Not tried: a real library's Liked Music.)
- [x] `S-M` Voice control beyond search: "next", "like this", "play my running playlist" (WinRT speech already there).
      (2026-11-05: in voice search, a command said alone runs instead of searching: next, previous, pause, play, like
      this, louder, quieter, and a play word with a playlist's name (only filler words around it: "play my running
      playlist"). English always, plus the interface language's phrases (`|` lists in the locale files; Chinese and
      Japanese matched without spaces). A toast says what was done, with Search instead. Settings › Shortcuts › Search by
      voice (no default key) listens at once. `features/search/voiceCommand.ts` (pure, tests on the real French and
      Japanese tables), `voiceRun.ts`. Decided alone: a voice only likes, never unlikes; nothing new is sent (the same
      listening). Tried: tests, the demo (the commands run by hand: its voice search is refused). Not tried: real speech.)
- [ ] `M` Concerts near the user from followed artists (a public API with no account; privacy row).
- [x] `M` Lyrics saved into local files and editable (Guayadeque, MusicBee): fix a line, timing tapped live.
      Read first (2026-11-01): a local song's own lyrics, the LRC beside it or its tag (USLT, LYRICS, ©lyr), come
      before the cache and the network (`local::lyrics`, `lyrics::from_file`), labelled as the file's; not cached.
      Saved too: Lyrics › Edit lyrics (a local song playing; Add lyrics when none were found) edits the text, LRC or
      plain, and writes it where the song keeps it (the LRC beside it, else its main tag, `local::write_lyrics`, the
      same copy-then-swap as Edit song info); Fix the timing › Save into the file writes the fixed timing, then the
      fix is cleared (Sync Mode carries that to the other PCs, whose files didn't change). Plain lyrics of a local
      song: Time them by tapping along (the timer button) shows each line in turn, Now stamps it (reaction time
      taken off, never before the line above), Back undoes one, then Save into the file writes the LRC. Other
      services' songs have no file to keep it: not offered. Unseen: real files (MP3, FLAC, M4A, OGG; MusicBee
      reading what we wrote), only tests on a WAV and the interface on fake data.
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
- [x] `S` Weighting (A or ITU-R 468) and a +3 dB/octave tilt option, so music looks level instead of bass-heavy.
      (2026-11-02: Settings › Playback › Visualizer weighting or the right-click, `vizWeigh.ts`: As measured (default), +3 dB per octave,
      A-weighting, ITU-R 468, added per band in the worker's scene, both twins alike. Tested against the A and 468
      tables; over the demo the tilt lowers the bass third and lifts the treble third. Not judged by eye on real music.)
- [x] `S` Spectrum bars, realistic: 1/3 and 1/12 octave, reflection on a glossy floor, frequency and dB scales on hover. (LED
      segments with held, falling caps are in, 1/6 octave.) (2026-11-04: Settings › Playback › Visualizer bands, 1/6
      octave by default or 1/3 folded from it, 31 bars, `vizBands.ts`; Visualizer reflection, off by default for the
      owner to judge: LED, bars, peaks and wave on a glossy floor; the pointer over a big visualizer shows 50 Hz to
      10 kHz along the top and a −20 / −40 / −60 dB grid. Seen over the demo, full screen. 1/12 octave needs finer bands
      from both twins: the `S-M` line below.)
- [x] `S` Colours from the theme or the cover (`coverTint.ts`): gradient along frequency, by level, or the cover's palette.
      (2026-11-02: Settings › Playback › Visualizer color or the right-click: the text colour (default), the theme's
      accent, or the playing cover's hue made vivid (`ambient.ts` `vivid`, 3:1 at least on the theme's background; a
      grey cover keeps the text colour). One colour per look, the painter unchanged. Checked over the demo: the accent
      draws; the demo's SVG covers average to grey, so the cover's colour was checked on a raster picture.)
- [x] `S` Visualizer gradients: along frequency or by level (the painter draws one colour; a `source-atop` gradient fill
      after the bars would recolour every straight look in one pass). (2026-11-04: Settings › Playback › Visualizer
      gradient or the right-click, off by default for the owner to judge: By level = the visualizer's colour, amber
      from half height, the alarm red at the top, from the middle out for the mirror, from the cover out for the ring;
      Along frequency = a prism, red lows to violet highs, the ring's from the bottom up both sides. Amber and the prism
      made 3:1 on the background (`vivid`). VU needles and the spectrogram keep their colours. Seen over the demo, both.)
- [x] `S` Sizes left: a big backdrop behind Now Playing, the mini player, the OBS overlay page. A click on the visualizer
      cycles its look (2026-11-04, `vizClick.ts`: the strip and the full screen, held 300 ms so a double click still
      takes it full screen or back; seen over the demo, LED to Bars to Mirror, a double click left it as it was; the
      owner judges it). The backdrop is in (2026-11-04: Settings › Playback › Visualizer behind Now Playing, off by
      default, the bottom half at 20 % behind the song; seen over the demo), and the mini player (Visualizer in the mini
      player, off by default: a thin strip under the song; seen in the floating one over the demo, the right panel's
      and the sidebar's not looked at). Left: the OBS overlay page. (2026-11-05: Settings › Playback › Visualizer on the
      overlay, off by default: 31 bars under the song, sent by server-sent events only while OBS shows the page.
      Decided alone: thirds of an octave, a strip rather than a backdrop in the card, the app's visualizer not needed.
      Tested on a socket and over a stand-in server; not in OBS.)
- [x] `S-M` 1/3 and 1/12 octave bands (31 and 120, ANSI centers) beside today's 1/6 (61 bands).
      (1/3 is in, folded from the sixths. 2026-11-04, decided alone: 1/12 = 121 bands on the sixths' base-10 scale,
      both ends in as the 61 are, from an 8192-point window in both twins so they resolve as the sixths do; Settings ›
      Playback › Visualizer bands › 1/12 octave, the engine's stream and YouTube's analysers start again on a switch.
      Tested: a sine lights its twelfth in both twins, the shared fixture in twelfths, the frames. Seen over the demo;
      not tried on real music, nor in the watch page.)
- [x] `M` Beat and onset detection (spectral flux on low and mid bands, tempo estimate): kicks drive pulses, flashes, camera.
      (2026-11-04: `vizBeat.ts` in the worker: onsets from the rise of the lows (40 to 160 Hz) and half the mids' (to
      2.5 kHz), over 1.5 times their last half second's mean plus 1.5 dB, 100 ms apart; the tempo from 8 s of that
      strength, 60 to 200 BPM leaning to 120. The Radial ring steps out 4 % on a kick (not with reduced motion).
      Decided alone: the bands, the threshold, the step's size. Waiting for their looks: flashes (under the flash
      limit), the camera (Spectrum 3D), the tempo shown. Counted on click tracks and on the demo's frames (19 kicks in
      10 s, 119.9 BPM); the ring's step not watched moving, not tried on real music.)

**Medium**
- [x] `S` Loudness stream (momentary / short-term LUFS, true peak) already measured by Adaptive Sound: exposed for meters.
      (2026-11-04: `loudFeed.ts`, one count per song for every view; while a meter is drawn its listeners ask
      `liveSync.ts` for the levels: the native poll, or YouTube's frame listening. The peak: a true peak since, below.)
- [x] `S` Loudness meter: LUFS bars (momentary, short-term, integrated), true peak, dynamic range of the song.
      (2026-11-04: the Loudness meter look, `vizLoud.ts`: momentary as measured, short-term over its last 3 s,
      integrated with BS.1770's gates, the loudness range (EBU Tech 3342) as the song's dynamic range, the peak now and
      the song's highest; three bars in the strip, words, scale and range from 120 px. The backdrop and the mini player
      show bars. Seen over the demo, full screen and in the strip; not on real music. True peak: the line below.)
- [x] `S` True peak (BS.1770 annex 2: 4x oversampling of the peak) in both twins' meters, for the loudness meter's peak.
      (2026-11-04: the standard's 48-tap table in `meter.rs` and live.js, a test holds them equal; the levels' peak is
      a true peak now, never under the sample peak. The meter says True peak in dBTP, its highest in the alarm colour
      over −1 dBTP. Tested on the standard's quarter-rate sine; not on real music, nor seen over an intersample over.)
- [x] `S` Smooth spectrum curve (filled area, glow), stereo overlay (left and right in two colours). (2026-11-04: the
      Curve look, left in the visualizer's colour, right in the accent, a glow off with reduced motion; seen over the
      demo.)
- [x] `S` Oscilloscope: the waveform, triggered on zero crossings so it stands still, phosphor afterglow.
      (2026-11-04: the Oscilloscope look, `vizScope.ts`: both sides as one, 256 samples (10.7 ms) from a rising zero
      crossing of the smoothed wave, an afterglow of 50 ms (three times it with reduced motion); it asks for the wave
      blocks only while it is the look. Decided alone: mono, the length, the glow. Seen over the demo; not on real
      music.)
- [x] `S` Vectorscope / goniometer (left vs right, Lissajous) with a correlation meter: stereo width at a glance.
      (2026-11-04: the Vectorscope look, `vizVector.ts`: points of mid and side in a diamond, fading like the scope,
      guides for mid, side, left and right; the correlation over each block eased over 300 ms, red below 0, under the
      square or beside it in the strip. Decided alone: points rather than lines, halved scale (full scale = the
      diamond, no auto gain). Seen over the demo; not on real music.)
- [x] `S` Unit tests: a sine lights its 1/12-octave band, a pink noise reads flat with the tilt.
      (The 1/6- and 1/12-octave sines, left-only, the twins' shared fixture and the 10 Hz strobe were in. 2026-11-04:
      pink noise reads flat as measured in both twins and white noise rises 3 dB an octave, 256 random-phase takes
      averaged, from 450 Hz up, sixths and twelfths. Bands sum energy, so pink noise is flat without the tilt, which
      makes it rise. Not seen in the app with a real pink noise.)
- [x] `S` A click track gives its BPM: the test of the beat detection above, when it lands. (2026-11-04:
      `vizBeat.test.ts`: 120, 93 and 128 BPM in sixths and twelfths, every click heard within a frame, the tempo within
      1.5 BPM, frames 8 ms uneven within 2; hiss and silence give none.)
- [x] `S-M` Time-domain blocks in the frames (L/R, 1024 samples, as i16) for scope and vectorscope. Left / right bands, rms and
      peak are in. (2026-11-04: the last 1024 samples of each side averaged in pairs, 512 a side at 24 kHz, as i16
      after the bands, flag 1 in byte 2, in both twins and only when asked: `viz_start(wave)`, the live wish's `wave`.
      Decided alone: half the samples keep a frame at 2.3 KB and a watch-page message under 3300 characters. Tested
      on packed and unpacked blocks; not on real music.)
- [x] `M` Particles on the beat (from the cover's colours), with the cover's blur behind (Plexamp-like backdrop).
      (2026-11-05: the Particles look, `vizParticles.ts`: soft dots burst from the middle on kicks, at most 3 bursts a
      second, drift with the mids, a trickle with the level; the cover's colours from `coverPalette.ts`; full screen
      over the blurred cover. Decided alone: Canvas 2D sprites rather than GPU particles (900 at most), the counts and
      sizes, bars in the backdrop and the mini player. Seen over the demo, full screen dark and light; not on real music.)
- [x] `M` Song waveform on the progress bar for local files (computed once from the file, cached; not for streams).
      (2026-11-05: Settings › Appearance › Progress bar › Song’s shape: 400 points of RMS in the levelling’s decode
      (`music_player::shape`), cached in SQLite `waveform` (schema 17), 120 bars on the seek bar, played part in ink;
      streams show the wave. Decided alone: RMS in dB rather than peaks (mastered songs would read flat), the counts.
      Seen over the demo with a made-up shape; not measured on real files in the app.)

**Low**
- [x] `S` VU meters: the PPM option and other skins. (Two needles with VU ballistics, the peak LED, the theme's ink are in.)
      (2026-11-05: the PPM needles look, IEC 60268-18 digital ballistics on the frames' sample peaks, a dBFS scale with
      knees; Settings › Playback › Meter face: theme colours or Vintage, a lit cream face. Decided alone: dBFS rather
      than a broadcast scale, the knees, one other skin (Vintage) and its colours; the full screen's dial centred and
      sized by its radius. Seen over the demo, strip and full screen, dark theme; not on real music, not in light.)
- [x] `S` Spectrogram colour maps as an opt-in (magma, viridis; today the theme's ink with opacity), WebGL.
      (2026-11-05: Settings › Playback › Spectrogram colors and the strip's menu: Theme colors, Magma, Viridis, from ten
      samples of matplotlib's maps (CC0), clear at silence, opaque from a quarter of the level. Decided alone: no WebGL
      (the Canvas 2D path already draws through a 256-step table), two maps, the fade-in. Seen over the demo, full
      screen dark; not in light, not on real music.)
- [x] `M` Spectrum 3D: a terrain of the last seconds flying towards the camera (WebGL).
      (2026-11-05: the 3D terrain look, `vizTerrain.ts`: 40 rows of 64 points, the newest at the front, going back in
      perspective with hidden lines cleared. Decided alone: Canvas 2D, not WebGL; the newest row at the front rather
      than at the horizon; no camera orbit or fog, a fade instead. Seen over the demo full screen, dark; the strip and
      the light theme not seen, not on real music.)
- [x] `M` Visualizer API for plugins (`crates/plugins`): a plugin gets bands, beat and loudness, draws with a restricted
      2D canvas command list (no raw access).
      (2026-11-05: permission `visualizer`, `app.visualizer.register / draw`, the `visualizer` event; shapes rect, line,
      shape, circle, text; example `examples/plugins/rings`; `docs/plugins.md`. Decided alone: a new permission, one
      look per plugin, positions as shares of the box, drawings as notes with no answer (60 a second, 256 kB), only the
      latest frame kept for a busy plugin, 30 frames a second, the overlay's 31 bands, the bars while the plugin is off,
      plugin looks out of the click round. Tried: Rust tests run the Rings example in QuickJS; the demo drew an
      injected look full screen, dark. Not tried: a plugin installed in the real app, the strip, the light theme.)
- [x] `L` Preset engine, written from scratch: equations per frame / per vertex driven by bands and beat (MilkDrop-style
      ideas), presets as small JSON shared like themes; `.milk` files the user owns loaded if a reader stays simple.
      (2026-11-05: the Presets look, `docs/playback.md` › Presets. Decided alone: our own equation language compiled to
      closures (no eval under the CSP), MilkDrop's variable names so .milk equations run; our own warp formula; a 32 × 24
      mesh shrinking for long point equations; WebGL2 in the worker copied onto the 2D canvas, the bars without it; 9
      built-in presets of ours, Tunnel the default; the theme's ink by default (the picture's light as opacity), the
      preset's own colours as a choice; the flash limiter on the picture's mean light; reduced motion = half speed, no
      beats; imported presets kept in the settings like own themes (32 at most, 16 kB each, synced); .milk read for its
      base values and equations only (no custom waves / shapes, shaders or motion vectors), our .json for export. Tried:
      the pure engine's tests (expressions, mesh, wave, music, .milk, files); the demo full screen, dark: Tunnel in the
      ink, Aurora in its own colours, the menu and Settings rows in French. Not tried: a real .milk file of the owner's,
      import / export through the real file dialogs, the strip under the cover, the light theme, real music.)

## Workflow (how we build it)

Today: every green push to master is a Beta prerelease (479 commits so far, check 5-11 min then release 10-16 min) and
Stable goes out by hand (`promote`); the smoke test runs on every push; `src-tauri/src/lib.rs` 2149 lines; CLAUDE.md
~15 kB read by every session.

Most useful first; the tag is the effort.

- [x] `S` Make the smoke test blocking: delete `continue-on-error` in `check.yml` (green on the last 6 checks, 2026-10-31).
      Still outside it: the YouTube embed (needs the network) and a real audio device.
- [x] `S-M` Release notes grouped (feat / fix), in the user's words, shown in the app after an update. `notesFrom`
      (`scripts/notes.mjs`) writes "### New", "### Fixed", "### Faster" over the subjects (GitHub shows them as headers);
      the app's What's new (the notice after an update, Settings › About) shows them as lists, headers in the user's
      language (`features/update/notes.ts`, `ReleaseNotes.tsx`); older flat notes still read. The lines stay the commit
      subjects in English: written for listeners already. Seen in the next Beta's update card first.
- [ ] `M` The "Check live in the real app" list as a scripted checklist (a dev-only page that drives each step and logs the
      result), so a pass takes minutes, not a session.
- [ ] `S` Faster CI: run the macOS job only on pushes that touch Rust or `src-tauri`, `cargo nextest`, `sccache`; Linux
      job stays crates only.
- [ ] `S` Trim CLAUDE.md to rules + pointers (structure details move to `docs/architecture.md`): cheaper sessions.
- [x] `S` Project skills for Claude Code: "release check", "add a setting" (schema, DEFAULTS_VERSION, search index, i18n),
      "add a connector" (module, mockito tests, privacy row): the repeated recipes written once.
      `.claude/skills/{add-setting,add-connector,release-check}/SKILL.md`, from what past commits touched; keep them
      in step when a recipe changes (a new place every setting must reach, a new check before a push).
- [ ] `M` Split `src-tauri/src/lib.rs` by feature (library, player, accounts, sources) like `detector.rs` / `editor.rs`;
      same for `crates/core/src/library.rs` (queries per table).
- [ ] `M` Typed `invoke` wrappers: the types are generated, the wrappers in `api.ts` stay by hand (no `tauri-specta`), so a
      command's name and arguments are still checked by eye.
- [ ] `M` Diagnostics: a crash that ends the process without a Rust panic (a native fault, a kill) leaves no line; Windows'
      event log and minidumps are not read.
- [x] `S` Issue templates on GitHub (bug with diagnostics, feature idea) and a public roadmap page on the website from
      this plan. `.github/ISSUE_TEMPLATE` (bug: what happened, the source, Copy diagnostics; idea: links what's next,
      says what can't be taken), the website's "What's next" (`#next`, `ROADMAP` in `content.tsx`: keep it in step with
      the Roadmap table above, minus what shipped). Both show only after a push.
- [ ] `S` `graphify hook install` (the user's go) so the graph stays fresh without asking; then drop the `.gitattributes`
      line it adds (the graph isn't tracked).

## Optimisation (how it runs)

Most useful first; the tag is the effort.

- [x] `M` Tray mode: measure what's left (WebView2 suspended?), drop it further if the page can be unloaded and restored.
      (2026-11-05: `pnpm bench` prints WebView2's part by process kind. Suspended: yes, after 5 min hidden and silent
      the page keeps 0 to 3 MB of 54 to 55 MB; the rest is WebView2's browser, GPU, network and crash processes (about
      27 MB, there while a webview exists) and the app (about 25 MB). Decided alone: the page stays loaded, unloading it
      gains 3 MB at most; closing the webview would cost a cold page at each show and what the page does from the tray.
      Seen, not looked into: the hidden page grows to about 50 MB before its suspend. Numbers in `docs/performance.md`.)
- [x] `S-M` Library at scale, its queries: 50 000 songs, every statement checked (indexes for artist, album, plays, likes).
      (2026-11-05: `per_song_statements_skip_whole_scans_at_50k_songs` builds 50 000 songs, 200 playlists of 250 and
      50 000 plays, runs what the app does with them and counts each statement's whole-table steps (SQLite's own
      counter, not `EXPLAIN QUERY PLAN` text: it sees what ran); `every_foreign_key_leads_an_index` checks the schema.
      Found: removing and merging a song, plays by date, and the check of every deleted song read a whole table.
      Schema v19: `playlist_tracks_track`, `plays_started`. No index for artist, album or likes: nothing in SQL looks
      them up (the interface filters its own copy). Left: opening a playlist reads every song's artist once
      (`channel_members`, judging its channels' talk), and the whole reads at start; times in `docs/performance.md`.
      Not tried: the owner's real library.)
- [ ] `M` Library at scale, the rest: search with FTS5, scans in the background with progress.
- [x] `S-M` Re-renders: profile the player bar, Up next and lyrics at 60 fps (`Progress.tsx`); Zustand selectors everywhere.
      (2026-11-05, React Profiler around the shell in the demo, dev build, a local song playing: paused = no render;
      playing = 4 commits a second (the engine's reports), the bar ~0.45 ms each; Now Playing with lyrics 9 ms a second.
      Up next was 52 ms a second: each report gave the queue a new empty array, so its whole list re-rendered. Now the
      report keeps what didn't change (`upcoming`, a dropped file's song): 2.9 ms a second. The bar itself was already
      one frame loop, quantized (2026-10-17). Not measured: a production build, YouTube's reports, Karaoke.)
- [ ] `S-M` YouTube embeds: one player reused instead of one per song where the crossfade allows; unload the hidden one.
      Left by the autopilot (2026-11-05): playback-critical, and the demo has no YouTube player to try it on.
- [x] `S-M` Performance budget in CI: front-end bundle size and Rust startup time; fail on a large regression. (`pnpm bench`
      isn't in CI yet.) (2026-11-05: `scripts/budget.mjs` + test, CI's check job on Windows after `vite build`: JS at
      launch (the page's script and the chunks it preloads) 970 kB, 307 kB gzip, fails over 340 kB gzip. Decided alone:
      gzip as the measure, about 10 % room, startup time left out of CI (a shared runner swings more than the regression;
      `pnpm bench` keeps that). Tried: the script on today's build, its test. Not tried: a CI run.)
- [x] `S` Bundle: LyricsPanel, dialogs and NowPlaying are still in the first chunk. Now lazy through `app/pages.ts`
      (Now Playing and the lyrics panel preloaded when idle; the dialogs' openers and hosts in
      `features/library/dialogs.tsx`, `VideoSlot.tsx` apart). JS at launch 904 → 853 kB (281 → 270 kB gzip), in
      53 files instead of 38: icons shared with the lazy chunks come apart. Rolldown's `inlineCommonChunks` would merge
      them, but it is experimental and forces `strictExecutionOrder`: left out.
- [x] `S` Installer size: check what's in it (`cargo bloat`, features of big crates, adblock lists compressed).
      The updater's default features pulled rustls and ring, never used (reqwest takes Windows' TLS for every client
      once our crates ask for native-tls): off, 11 crates fewer. `legato.exe` 35.9 → 34.4 MB, 10.46 → 9.91 MB
      compressed (xz -9, close to what NSIS' LZMA gives), 2026-11-01. Nothing else cheap: the adblock lists are
      downloaded and cached, not built in; the interface is 3.6 MB of JS, each of the 17 languages loaded only when
      used; `third-party-licenses.html` 0.5 MB; the release profile already has LTO, one codegen unit and strip.
      Left alone: `opt-level = "s"` (slower code) and `panic = "abort"` (a panicking thread would end the app).
      `cargo bloat` not installed (no tool installed without the owner). Unseen: a real update through it (same TLS
      as before, but check the next Beta installs).
- [x] `S` Cover thumbnails for WebP and GIF originals, served whole today (the `image` crate here has PNG and JPEG only; the
      hosts send JPEG). The `image` crate reads WebP and GIF now (5 small pure-Rust crates, licenses checked): WebP
      (YouTube's `vi_webp` frames) and GIF get thumbnails, PNG when they have see-through parts, JPEG otherwise; an
      animated one gives its first frame. Saving a WebP or GIF cover still writes the original as it is.

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
- [x] `pnpm bench` on a quiet PC: the full run on af27405 was disturbed (someone back at the PC: load 78 %, restart 1.91 s,
      tray 135 MB, the page awake again after its suspend), row not kept. The website's numbers come from d853980: confirm the
      54 MB in the tray after Visualizer v2, or find what wakes the page and fix the numbers.
      (2026-11-05: confirmed, 54 and 55 MB in two full runs on 58679a9, the page suspended both times. Neither PC was
      quiet (the demo's Vite server, then another app: load 68 to 78 %), rows not kept; a clean row is still to make.)
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

## Waiting on the user (outside the code)

- [ ] Discord shows "Listening to Music App": that's the name of the app on Discord's developer portal (rename it there).
- [ ] Trademark search for Legato (INPI, EUIPO, USPTO classes 9, 41, 42).
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).
- [ ] SponsorBlock stays off by default (a new third party gets a hash prefix per video, the user opts in): flip the
      default if wanted.
- [ ] Spotify: try Ctrl+A, Ctrl+C on a private playlist in the desktop app and paste into Notepad (links, one per line?).
- [ ] Spotify: ask for the data export (Privacy settings › Download your data); its `Playlist1.json` is the test file:
      open the ZIP in Add music › Connect Spotify › Open Spotify's data export (are private playlists in it?).
- [ ] A playlist file from foobar2000 / VLC / MusicBee, and an `iTunes Music Library.xml`, through Add music.
- [ ] Quit the installed Legato from the tray and open it again: a session closed its hidden single-instance window by
      mistake on 2026-10-31.
- [ ] The soft glow on the sung line (`LyricsPanel.tsx`) goes against "no glows" in `docs/design.md`, and `SONG ENDS`,
      `NEXT SONG`, `PREVIEW` are still written in capitals: keep or change (the capitals are keys in all 17 languages).

## Not done yet

**Spotify** (no keys; the user chose link import)
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- [x] Local only: `ui/dev/` preview harness, deleted 2026-11-05 (the site demo, `site/demo`, does its job).
- Dependabot alert #1 (`glib` 0.18, Linux only, through Tauri's GTK3 stack) dismissed: re-check at each Tauri upgrade.

## Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
- No circumventing Premium or DRM. Quotas respected, no server of ours.
