# Last batch

## Long mixes and DJ sets split by chapters

- **Sees**: a 2-hour YouTube mix shows as its tracks in Up next (from the video's chapters or the timestamps in its
  description / pinned comment); next / previous jump between them; each part can be liked, added to a playlist
  (found as its own song), scrobbled; Music Detector names unlabelled parts on request.
- **How**: chapters from the watch page's InnerTube answer (`ytweb.rs` / `ytmusic.rs` already read video data), or a
  timestamp parser over the description (`0:00 Artist - Title`, `[12:34] …`), pure and tested in `crates/core`.
  Player: a "part" layer over one video (seek within, progress per part).
- **Rules**: playback stays the YouTube embed; nothing cut out of it.
- **Effort**: M. **Risk**: messy timestamps (only accept increasing times with ≥ 3 entries).
- **Done when**: 10 real mix descriptions parse (saved fixtures); next / previous move within the video.

## Audiobooks from local files

- **Sees**: an Audiobooks page (folders marked as audiobooks): book cover, chapters (m4b chapter atoms, or one file per
  chapter), resume per book, speed, sleep at chapter end; never in mixes, shuffle or stats.
- **How**: `music_core::local` reads MP4 chapters (`mp4` crate) and marks folders; positions in SQLite; speed via
  `stretch.rs`.
- **Effort**: M. **Done when**: an m4b resumes at the right chapter after restart.

## Playlists as files

- **Sees**: playlist menu › Export (M3U8, XSPF, CSV) and Add music › Import a playlist file.
- **How**: writers / readers in `crates/core` (M3U8: local paths relative to the file when possible, streams as
  `https://music.youtube.com/watch?v=…` lines with `#EXTINF`); CSV reuses `songlist.rs`.
- **Effort**: S. **Done when**: an exported M3U8 of local songs opens in VLC and foobar2000; re-import round-trips.

## Library health

- **Sees**: Library › Health: missing files (moved / deleted, with "Locate…"), YouTube videos gone private or removed
  (with "Find another version": `alternative_videos` exists), songs without covers or tags, duplicates (the dialog
  exists), each a fix in one click.
- **How**: checks in Rust (file exists; YouTube availability during normal plays and a slow background check),
  results in a table; UI page reusing existing dialogs.
- **Effort**: M. **Done when**: each kind shows on the demo library with planted problems.

## Output devices

- **Sees**: a device picker on the player bar (speakers, headphones, HDMI…); Legato's choice remembered; "Follow
  Windows' default" by default.
- **How**: native: `cpal` output device selection in `crates/player`. YouTube in WebView2: `HTMLMediaElement.
  setSinkId()` on the embed's video (needs the audio-output permission in WebView2: check it's allowed for the embed
  frame; the shield script runs inside it).
- **Effort**: M. **Risk**: setSinkId inside YouTube's cross-origin iframe (our script runs there: test).
- **Done when**: both native and YouTube switch without restarting the song.

## Sleep timer: end of album, fade

- **Sees**: Sleep › At the end of this album; "Fade out over the last 2 minutes" option.
- **How**: `sleep.ts` (has minutes and 'song'): add 'album' (stop after the last track of the playing album in the
  queue) and a volume ramp via `fade.ts`.
- **Effort**: S.

## Profiles on one PC

- **Sees**: top bar › profile picture: switch person; each has their library, likes, history, settings, accounts.
- **How**: one data folder per profile (library DB, settings, keychain entries prefixed by profile id), the app reloads
  on switch. Sync Mode per profile.
- **Effort**: M-L. **Risk**: secrets mixing (keychain names must carry the profile).
- **Done when**: two profiles never see each other's history; switching takes < 2 s.

## Living-room mode

- **Sees**: View › Living room: big text and covers, navigation by gamepad (XInput) or arrow keys, focus always
  visible, on-screen keyboard for search.
- **How**: a layout scale + spatial navigation (a focus manager over `data-nav` elements); Gamepad API in WebView2
  (works) mapped to actions.
- **Effort**: L. **Done when**: every page usable with an Xbox controller only.

## Stream Deck plugin and Game Bar widget

- **Sees**: Stream Deck keys: play / pause, next, like, the cover on a key; Xbox Game Bar widget: now playing and
  transport over a game.
- **How**: Stream Deck SDK plugin (Node, its own repo or `extras/streamdeck`) talking to the local WebSocket server
  (phone remote's); Game Bar widget = a UWP widget project (heavier: maybe later).
- **Rules**: localhost only, token.
- **Effort**: M (Stream Deck), L (Game Bar).

## Voice control

- **Sees**: the voice button (or a hotkey) understands "next", "pause", "like this", "play my running playlist",
  "shuffle Daft Punk", in English and French.
- **How**: WinRT speech exists (`speech.rs`, online recognition); a small intent parser (pure, per language) maps
  phrases to actions from `keys.ts` and searches.
- **Effort**: S-M. **Done when**: 20 phrases per language recognised in tests on the parser.

## Blind test game

- **Sees**: Play › Blind test: pick a playlist, 10 rounds of 15 s snippets from random points, type or pick the title /
  artist, scores; local multiplayer (each player on their phone through the remote page, or taking turns).
- **How**: rounds from the library (YouTube embed seeks; local files), answers fuzzy-matched (`matching::normalize`).
- **Rules**: snippets are normal playback.
- **Effort**: M.

## Share a song as a picture

- **Sees**: song menu › Share as picture: a card (cover, title, artist, a lyric line picked by the user, the theme's
  colours, Legato's small mark) copied or saved.
- **How**: canvas render in the front end, save through Rust (`export_cover` pattern), clipboard via Tauri.
- **Effort**: S.

## Theme and plugin gallery

- **Sees**: Add-ons › Gallery: themes and plugins with screenshots, author, verified mark, install (themes: one
  click; plugins: the usual permission review).
- **How**: an index JSON in a public GitHub repo (`Clovis500c/legato-gallery`), fetched by Rust once a day; files
  downloaded from that repo only (pinned commit hashes in the index); authors submit pull requests, reviewed.
- **Rules**: no server of ours (GitHub hosts files); privacy row; signature or hash check before install; never
  run code before the permission review.
- **Effort**: M. **Done when**: a theme installs from the gallery; a modified file (hash mismatch) is refused.

## Privacy page in the app

- **Sees**: Settings › Privacy: every host Legato contacted today, when, why ("lrclib.net: lyrics for Song X"), from
  which feature; links to the website's rows.
- **How**: a small in-memory log in the Rust network layer (connectors share a client: add a hook), feature labels per
  connector; the plugin gateway logs too.
- **Effort**: S-M. **Done when**: a day's use shows only the hosts the website lists (a test compares the connector
  host list with the website's rows).

## Right-to-left languages and community translations

- **Sees**: Arabic and Hebrew interfaces mirrored correctly; anyone can help translate on Weblate.
- **How**: `dir="rtl"` on the root for RTL languages, logical CSS properties (Tailwind's `ms-` / `me-` instead of
  `ml-` / `mr-`), icons that point (arrows) flipped; Weblate connected to `shared/i18n/locales/*.ts` (it supports JSON;
  a small converter or switch the locales to JSON).
- **Rules**: `i18n.test.ts` keeps failing on missing French; other languages may be partial (English fallback).
- **Effort**: M. **Done when**: Arabic UI walkthrough shows no left-right bug on the main pages.

## Community

- **Sees**: About › Community: GitHub Discussions (or a Discord server), how to report a bug (with Copy diagnostics),
  how to suggest an idea.
- **How**: enable Discussions, issue templates ([workflow.md](workflow.md)), labels "good first issue", a showcase of
  community themes on the website.
- **Effort**: S. **Done when**: templates live, the About links work.
