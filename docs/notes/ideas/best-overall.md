# 3. Best overall

What Spotify, Apple Music, YouTube Music, Plexamp and MusicBee users expect, done locally and without a server.

## "Wrapped": yearly / monthly recap

- **Sees**: in December (and on demand from Stats: any month or year), a full-screen story: minutes listened, top
  songs / artists / albums, the song of each month, the most played hour, new artists discovered, longest streak, a
  "listening personality" from simple rules; each card saved as a picture.
- **How**: everything is in our history (`crates/core/src/history.rs`, `features/stats/stats.ts`). A pure
  `recap.ts` computing the cards (tested), a story view with the cover-tinted backgrounds, pictures rendered on a
  canvas and saved through a Rust save dialog (`export_cover` shows the pattern).
- **Rules**: local only; Sync Mode merges histories so a recap covers all PCs (say when one PC isn't synced).
- **Needs**: nothing.
- **Effort**: M. **Risk**: little history for new users (show from 30 days of plays on).
- **Done when**: a recap of the demo library's fake year renders; numbers match Stats; pictures saved at 1080×1920.

## Artist radio and endless radio

- **Sees**: Play radio on an artist, album or playlist (song radio exists: `features/player/radio.ts`); Settings ›
  Playback › "Keep playing similar songs when the queue ends" (autoplay exists in `autoplay.ts`: extend to the radio).
- **How**: seeds = several songs; YouTube Music's radio from an artist's top song (signed in or the public catalog via
  `ytm_or_public`), library songs that fit (`fit.ts`), later sonic similarity ([indie.md](indie.md) › Sonic
  analysis). Refill when 3 songs are left; never repeat within the session; "Never in mixes" respected.
- **Rules**: none new.
- **Needs**: nothing.
- **Effort**: S. **Risk**: none.
- **Done when**: an artist radio runs 2 hours without a repeat, a disliked song never comes back.

## Smart shuffle and time-of-day mixes

- **Sees**: Shuffle has a "Smart" mode: no song heard in the last hours first, artists spread out (never two in a row
  unless the list is one artist), a few liked-but-forgotten songs mixed in. Home gets a "Daylist" mix that changes
  with the time of day (morning calm, afternoon focus, evening upbeat), named from what it holds.
- **How**: shuffle in `features/player/queue.ts`: a pure weighted order (history from `listens.ts`). Daylist in
  `crates/core/src/mixes.rs`: plays bucketed by hour of day (we have timestamps) → what you play at this hour; mood
  words from tags / sonic features when they exist (`features/mixes/words.ts` names mixes already).
- **Rules**: local.
- **Needs**: sonic analysis improves Daylist, not required.
- **Effort**: S (shuffle), M (Daylist). **Risk**: none.
- **Done when**: unit tests: 100 shuffles of a 3-artist playlist never put an artist twice in a row; Daylist differs
  between 8:00 and 22:00 on a seeded history.

## Genre, year, BPM and key tags

- **Sees**: Genre and Year columns in the library, filters and smart rules on them; BPM and key shown in song info;
  mixes by genre / era ("90s rock").
- **How**: local files: read the tags (`lofty`: genre, date, TBPM, TKEY). YouTube Music: album pages give the year,
  not genre. MusicBrainz / Last.fm tags (user's key) for genre. BPM / key without tags: sonic analysis. New columns
  (migration), smart rule fields in `rules.ts`.
- **Rules**: privacy rows for any lookup.
- **Needs**: library migration.
- **Effort**: M. **Risk**: genre quality (free text): fold to a small set for mixes, keep the raw tag for display.
- **Done when**: a smart playlist "Rock, 1990-1999" works on local and YouTube songs that have the data.

## Podcasts by RSS

- **Sees**: a Podcasts page: subscribe by RSS link or a search (Podcast Index or iTunes podcast search, keyless),
  new episodes, resume per episode, speed 0.8-3×, skip silence, chapters, mark played; downloads for offline (open
  feeds give a file URL: allowed, it is the publisher's own distribution).
- **How**: `crates/connectors/src/podcast.rs` (RSS / Atom parsing, `feed-rs`), episodes in SQLite (new tables), audio
  through `crates/player` as HTTP sources (shared with personal servers), speed via `stretch.rs` (pitch kept).
- **Rules**: only open RSS (no Spotify / Apple exclusive shows). Feed refresh from Rust, privacy row (feed hosts).
- **Needs**: HTTP streaming in the player.
- **Effort**: L. **Risk**: scope creep; keep music first (Podcasts as a page, not mixed into Home).
- **Done when**: subscribe, play, resume after restart, 1.5× sounds natural, new episodes notified.

## Internet radio stations

- **Sees**: a Radio page: search stations (Radio Browser's open directory: name, country, genre), favourites, play;
  song title shown when the stream sends it (ICY metadata), "Add this song" finds it on YouTube.
- **How**: Radio Browser API (`all.api.radio-browser.info`, keyless, pick a server from DNS), streams through the HTTP
  player (MP3 / AAC / Ogg), ICY metadata parsing in `crates/player`.
- **Rules**: playing a public stream is listening (no recording, no export). Privacy rows.
- **Needs**: HTTP streaming.
- **Effort**: M. **Risk**: HLS-only stations (support later).
- **Done when**: 20 popular stations play, titles update, favourites synced by Sync Mode.

## Release radar

- **Sees**: Home › New from your artists: albums and singles released in the last weeks by artists you play, with a
  notification option.
- **How**: per top artist (from history), YouTube Music artist page (`ytm_artist`: has releases with years) or
  MusicBrainz release groups by date. Refreshed once a day at a quiet moment, cached.
- **Rules**: requests spread out (quota), privacy row (MusicBrainz) / unofficial API note (YouTube Music).
- **Needs**: nothing.
- **Effort**: M. **Risk**: artist identity (same name, different artists: use channel / MBID).
- **Done when**: a new album of a top artist appears within a day of release in a test with recorded answers.

## Concerts near you

- **Sees**: on an artist page, upcoming concerts near the user's city (asked once, stored locally); a Home card when a
  top artist plays nearby.
- **How**: needs a public events API: Bandsintown (app id per developer, free, terms on display), Songkick (closed to
  new keys), Ticketmaster Discovery (key). User's own key, like Last.fm, or a public app id if terms allow.
- **Rules**: city stays on the PC; only the artist name and city sent. Privacy row. Kept apart until the user picks
  the API.
- **Effort**: M. **Risk**: API terms.
- **Done when**: user's go on the API, a city set, concerts listed with ticket links.

## Mobile companion (Android first)

- **Sees**: an Android app: the same library and playlists (from Sync Mode's folder or the LAN code), YouTube songs
  played in YouTube's embed, local files on the phone, the phone remote for the PC, Last.fm.
- **How**: Tauri 2 mobile (Android target) reusing `crates/core` and `connectors`; UI from `ui/` with a phone layout.
  Sync: OneDrive folder via Android's document provider, or the LAN.
- **Rules**: all of CLAUDE.md applies; Play Store policy on YouTube embeds (background play forbidden by YouTube's
  terms: foreground only).
- **Needs**: macOS / Linux groundwork (platform abstractions), a phone design pass in Figma.
- **Effort**: L+. **Risk**: the biggest item on the list; do last.
- **Done when**: an APK plays the synced library on a real phone.

## macOS and Linux builds

- **Sees**: downloads for macOS (signed, notarized) and Linux (AppImage / deb / Flatpak) on the website.
- **How**: per-OS pieces today on Windows only: media panel (`media.rs`: MPRIS on Linux, MPNowPlayingInfoCenter on
  macOS), mic / loopback (`mic.rs`: ScreenCaptureKit / PulseAudio monitor), voice search (WinRT), mixer naming,
  thumbbar, tray details, WebView2 cookies (WebKit on both: the YouTube Music sign-in and InnerTube cookies need a
  different store), shield hook (`shield.rs` is WebView2-specific). CI already builds macOS; Linux needs WebKitGTK.
- **Rules**: same.
- **Needs**: a Mac for signing (Apple Developer account, paid) and testing.
- **Effort**: L. **Risk**: the YouTube sign-in and ad shield depend on WebView2 hooks: the biggest port.
- **Done when**: each OS plays local + YouTube, media keys, updates; features not ported hidden (no fake buttons).

## Accessibility pass

- **Sees**: everything reachable by keyboard with a visible focus ring, screen readers (Narrator, NVDA) read rows,
  buttons, the player state and song changes; contrast AA everywhere; Windows' reduced motion and high contrast
  respected; text scales to 200 % without breaking.
- **How**: audit with axe-core in a dev build (the `ui/dev` harness), roving tabindex in virtual lists (TrackTable),
  `aria-live` for song changes, `forced-colors` CSS for high contrast, focus traps in dialogs.
- **Rules**: none.
- **Needs**: E2E harness helps (keyboard flows as tests).
- **Effort**: M. **Risk**: virtualized lists and screen readers (announce position "song 12 of 340").
- **Done when**: axe shows no serious issue on every page; an NVDA walkthrough (add a song, play, queue) recorded.

## Import from other apps

- **Sees**: Add music › From another app: MusicBee / iTunes `iTunes Library.xml` (playlists, play counts, ratings,
  dates added), Spotify likes and YouTube likes in one go, a Last.fm history import to seed stats and mixes.
- **How**: XML parser (plist) in `crates/core` mapping file paths to local songs (folder must be watched); Spotify
  likes need the user's sign-in (web session, the plan's open item); YouTube likes exist through YouTube Music;
  Last.fm `user.getRecentTracks` paged (user's key) into history with a "from Last.fm" flag.
- **Rules**: local files only for MusicBee/iTunes; privacy rows already cover Last.fm.
- **Needs**: nothing (Spotify likes need its web session).
- **Effort**: M. **Risk**: big histories (100k scrobbles: background, resumable).
- **Done when**: an iTunes XML with 5 playlists imports, play counts show in Stats.
