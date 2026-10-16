# Music App v2: plan

Status: **phases 1 to 5, 7 and 8 delivered** (2026-10-16): Hi-Fi redesign, themes, ad shield, custom playlists, local folders, add by YouTube link, Apple Music and YouTube search, one queue for every source with Apple previews, playlist sharing (link, QR, nearby code), local personalized mixes. Phase 6 (polish) under way: shortcuts, media keys, tray done; big round of player and library requests done (see "User requests 2026-10-16 (second session)"). Edit, strike or comment this file directly, or answer in the chat.
Mockups: Figma, file "Bow Game / Music App", page **"Music App v3 — Hi-Fi"**. The v2 "Apple" page is abandoned.

## 0. Your decisions (to fill in)

| # | Question | My proposal | Your answer |
|---|---|---|---|
| 1 | Visual direction | **Hi-Fi**: Dieter Rams' Braun devices. Warm paper and ink, one accent, LEDs, round buttons, mono readouts | |
| 2 | Default accent | Signal orange `#FF5A1F`. 6 accents to choose from + custom color, never a gradient | |
| 3 | Themes | Paper by default. 6 ready-made themes (Paper, Graphite, Studio, Aluminum, Bakelite, Sage) + System + **theme editor** | |
| 4 | Player | Full-width deck at the bottom (position adjustable: bottom, top or floating) + full screen | |
| 5 | YouTube API key (free, no sign-in) for search | Yes | |
| 6 | Apple Developer ($99/year) to try full Apple Music playback | Not for now: previews and YouTube fallback | |
| 7 | Spotify Premium | Not now: links, previews and YouTube fallback | |
| 8 | App name | "Music App" for now | |

## 1. What works without signing in (checked 2026-10-15)

| Service | Add a track | Full playback | With an account on top |
|---|---|---|---|
| **YouTube** | Search with a free API key (about 100 searches a day). Pasted link: oEmbed, no key | **Yes**: official embedded player (proven in the app) | Import playlists and "Likes", export playlists |
| **Apple Music** | Search the public iTunes catalog, **no key** (about 20 requests/min). Pasted link: lookup by id | 30 s preview, then automatic YouTube fallback | Full playback: MusicKit + Apple Developer + subscription + DRM. High risk in WebView2 |
| **Spotify** | **Pasted link only** (oEmbed). Without Premium, the whole Spotify API refuses dev-mode requests, search included (February 2026 rule) | Preview through the official Spotify player, then YouTube fallback | Premium: drive the Spotify app (Spotify Connect, see `../playback.md`) |
| **Local files** | Watched folders, drag and drop | Yes (gapless Rust engine) | — |

Playback rule: for each track, play the best available source. **Local file, then YouTube (full), then connected service, then 30 s preview.**
"Find versions" links tracks across services (ISRC, or title + artist + duration) and uses the YouTube quota with a cache.

## 2. Data (crates/core)

- `tracks` stays the shared record (title, artist, album, duration, ISRC).
- **New** `track_sources(track_id, source, source_id, url, playable: full|preview|none, preview_url)`, replacing `Track.ids`.
- **New** `library(track_id, added_at, origin)`: a track can be added without being in a playlist.
- Playlists: `kind = custom | imported(source)`, `playlist_items(position, track_id, added_at)`.
  An imported playlist is a read-only mirror, with a "Duplicate as custom playlist" button.
- Versioned SQLite migrations (`user_version`). Backup export and import as JSON.

## 3. Phases (one tested step = one small commit)

**Phase 1: "Hi-Fi" redesign and customization engine** (L) — done
- Design system:
  - tokens per theme (Paper, Graphite, Studio), variable accent, no gradient;
  - fonts Schibsted Grotesk (text, titles) and Geist Mono (readouts, labels), both under the free OFL licence and bundled;
  - Phosphor icons;
  - components: round button (primary, ink, outline, raised), LED filter, readout, volume knob, tuner scale,
    switch, round segmented control, track list, deck, settings group.
- Custom title bar (`decorations: false`, drag area, Windows buttons).
- Screens: Home, Songs, Albums, Artists, Recently added, Playlist, Add, full-screen Now Playing, Settings.
- Settings engine: one typed schema (Rust + TS), saved locally, applied live through CSS variables.

**Customization (core of the project, without becoming confusing)**
- Appearance:
  - theme;
  - accent;
  - cover shape (sharp, rounded, vinyl);
  - list density;
  - text size;
  - player position;
  - digital readout;
  - volume knob or bar;
  - tuner scale;
  - list columns (choose and order).
- Home in sections: show, hide, reorder (Resume, Your week, Recently added, Your playlists, Rediscover…), with options per section.
- Sidebar: reorder and hide entries, pin playlists.
- Themes:
  - 6 ready-made themes + System;
  - **editor**:
    - colors with their hex code;
    - font: Hi-Fi or Neutral;
    - radii from 0 to 16 px;
    - LED glow;
    - cover tint;
    - AA contrast checked live, with a warning when a text becomes unreadable;
  - duplicate, export or import as `.theme`.
- Screens fixed after the user review (`ui-review.md`):
  - actions visible on hover;
  - dockable right panel (queue, info, local lyrics);
  - big cover;
  - queue with multi-select;
  - true shuffle;
  - playlist folders;
  - CLIP / LIVE badges;
  - cover tint.
- To stay readable:
  - search in settings;
  - live preview;
  - "Reset" everywhere;
  - advanced settings hidden by default;
  - settings grouped by screen (Appearance, Playback, Library, Sources, Shortcuts, Notifications, Advanced).

**Phase 2: universal library and custom playlists** (L) — done
- Schema migration; add from a search or a link (Ctrl+V anywhere = link detected).
- Custom playlists: create, rename, reorder, duplicate, delete, multi-select, "Add to…" menu.
- Local folders: scan and tags (`lofty` crate), change watching (`notify` crate, not yet).

**Phase 3: multi-catalog search** (M) — done
- iTunes catalog (no key), YouTube (key, quota counter shown), local files; duplicates merged by `match_key`; cache.
- Spotify: links only (title and cover through oEmbed, artist completed by a search; to prototype).

**Phase 4: smart playback** (L) — done
- One queue for every source (local file, YouTube, preview); local runs stay gapless.
- Apple previews played by the Rust engine (downloaded by Rust into memory, never from the UI, never to disk), with a "Listen on Apple Music" link.
- "PREVIEW" badges; playability line (full / preview / no source) with "Find full versions"; "Play via" inputs in Now Playing.
- Not done: preview straight from search results (before adding), Spotify previews.

**Phase 5: accounts (optional)** (M) — done, except a real-account check:
- YouTube export: any playlist (not YouTube imports) → private YouTube playlist. Export again = same playlist, only missing
  videos added; stops cleanly at the daily quota and resumes next time (remote id saved before adding). Removals and
  reordering are not mirrored. Tested with mocks; not run on a real account (YouTube not connected on the dev machine).
- Spotify Connect: player API, IPC and "SP" input built and mock-tested (see `../playback.md`); needs Premium to try for real.
- MusicKit: not started (needs an Apple Developer account).
- Update 2026-10-16 (user's choice): YouTube keys removed. Google sign-in in an app window + YouTube Music's web API
  (`crates/connectors/src/ytmusic.rs`): library sync for several accounts, search with no daily limit, export with no quota.
  Checked on the real account: 12 playlists / 2,587 tracks synced, search, Find full versions, export + resume.

Original plan:
- YouTube: import (already there), export a custom playlist (quota: about 190 tracks a day).
- Spotify Connect if Premium one day (plan written). MusicKit prototype if Apple Developer account.

**Update 2026-10-16 (user's requests)** — done:
- Theme: System follows Windows light/dark and the Windows accent (WinRT `UISettings`, AccentDark1 on light themes,
  AccentLight2 on dark, re-read on focus) with new Modern / Modern Dark presets (YouTube's palettes and Roboto). Text on
  any accent keeps AA 4.5.
- Cover art: `tracks.art` (schema v3), filled by YouTube Music (544 px), YouTube frames, iTunes (600 px), Spotify and
  local tags. Images go through the `art` URI scheme (Rust, host allowlist, 300 MB LRU disk cache); CSP img-src has no https.
- One player for every source: shared transport with shuffle and repeat (off / queue / track), Now Playing fitted to the
  window (controls never cut off), flat cover tint, mini player.
- Right-click menus everywhere; play next / add to queue.
- More options: font, covers in lists, one-click play, sidebar counts, start screen, animations; interface size on Apply.
- Real Google profile pictures in Settings › Accounts; Inputs box removed from the sidebar.
- Spotify without keys: public playlists and albums by link (embed page, first 100 tracks), played through their
  YouTube versions; Spotify's own web player in a window (preview). See `../playback.md`.

**To do next (2026-10-16, session stopped on the usage limit)**
- Spotify without keys (user chose link import, 2026-10-16), still open:
  - private playlists and Liked Songs need the web session (token capture or TOTP): not planned unless the user asks;
  - playlists over 100 tracks: only the first 100 come in (embed limit);
  - keep or remove the Spotify app-key path (Settings › Accounts);
  - Spotify ad blocking: only after the ToS / account risk is confirmed in chat;
  - user signs in to the web player window, then check real playback (Widevine / PlayReady are available).
- Check live (built and unit-tested, not driven in the real app yet): repeat one / repeat all at a track's end, play next
  and add to queue, menu actions that write (rename, delete, export, remove from playlist), one-click play, start screen,
  local file covers (no music folder on the dev PC), Apple cover backfill (no Apple tracks), Spotify covers.
- Small fixes: 1,731 YouTube videos keep a video frame as cover. Done 2026-10-16 (second session): no light flash
  before a dark theme (window background from the saved theme, theme cached for the first paint); shuffle or repeat one
  turned on mid gapless run takes effect at once (engine `truncate`).
- Older open items: playlist trackCount vs rows (Workout Mix), "Music App export test" playlist on YouTube Music (ask
  before deleting), add-another-Google-account and sign-out untested live, Figma mockups still in French.

**User requests 2026-10-17 (third session)** — in progress. Work top to bottom, tick each line when committed, so a new
session can resume here. Phase 6 comes after all of them.
- [x] Adding to a YouTube Music playlist fails with `STATUS_FAILED` (seen from an album page): find why (duplicate?
      wrong id?), fix, and show the real reason instead of "only playlists you own".
- [x] YouTube's own overlay (title, share, "More videos", logo) sometimes shows when a song starts and never leaves: never
      show it.
- [x] Source pill in the deck ("● YOUTUBE"): icon only.
- [x] Reopen in Now Playing when the app was closed there (save it with the last screen).
- [x] Toasts: "Added to <playlist>" / "Removed from <playlist>" (and already-there / failure).
- [x] List covers: video frames cropped to the real art and centered (same bar detection as the big cover).
- [x] Discord: own buttons are hidden by Discord on your own profile (friends see them). Explain, no fix.
- [x] Fade: simple setting by default; Advanced › advanced fade with a curve editor (shape of fade out / in, overlap,
      graph of both volumes over time).
- [x] Interactive preview for visual settings (background blur, dimming, motion, …): small live sample of the effect.
- [x] Artists and Albums: filter and sort, like songs in playlists.
- [x] Mixes: better algorithm, more mixes; covers as a 2×2 grid like playlists, setting in Advanced: grid / single
      cover / current template.
- [ ] Smart cache in Rust for most of the app (memory + disk, invalidated on change).
- [ ] Home: quick access to every section + recommendations (local mixes, then the connected services' own
      recommendations: YouTube Music home feed, Spotify if possible).
- [ ] Phase 6: auto-updates in the background, never cutting playback, install and relaunch at once (resume where it
      was); Settings › About: version, last update, update status.

**Phase 6: polish** (M) — started 2026-10-16
- Done: keyboard shortcuts (Settings › Shortcuts), media keys and the Windows media panel (title, artist, album, cover),
  written on the `windows` crate (SMTC) instead of `souvlaki` (would add an older `windows` version). Checked live: panel
  metadata and cover, play from the Windows session, Space, Ctrl+,, Alt+←. Mini player: done.
- Done after: tray icon (track, play/pause, next, previous, show, quit), seek bar in the Windows panel (checked live:
  position and length read back from Windows' session list).
- Not done: media panel off Windows.
- Auto-updates (`tauri-plugin-updater`, requires signing the app), installer, performance (50,000 tracks), accessibility (AA contrast, keyboard navigation).

**User requests 2026-10-16 (second session, user testing live)** — done, unit-tested, mostly seen in the running app:
- Player: bare YouTube video (official `controls=0` & co, no hover; option in Advanced), subtitles off by default,
  YouTube-like bar / time / volume, bigger shuffle and repeat with names, source as one small icon, one embed for a
  run of YouTube tracks (`loadVideoById`, no reload between songs), fade out / in between songs (5 s, Settings ›
  Player), blocked videos (100 / 101 / 150) play another upload of the same song or skip.
- Now Playing: under the title bar (Close player there, Back / Esc), Video / Cover / Auto (YouTube's 3 frames compared:
  still image = cover), sharper cover (1200 px, maxres), immersive blurred background (on by default; blur, dimming,
  motion in Advanced), foldable Up next, smooth 60 fps bar that never shifts the layout.
- Mini player: drag, snaps to 8 spots, resizable, video follows it (window maximize fixed).
- Library: one-click play, YouTube-style sort menu (also per playlist), hide playlists (Playlists title › Hidden),
  playlist covers (logo, first song, grid of 4, custom image), add to imported YouTube Music playlists (Liked = like).
- App: clearer YouTube import (auto after sign-in, Import playlists now), resume playback and reopen the last screen on
  launch, Advanced section, settings search, new defaults applied once (`defaultsVersion` 3).
- User's choices with YouTube-terms risk (like the shield): Cover mode hides the video while YouTube plays.
- To check live: tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user owns, a
  blocked video falling back, Auto on a real music video, resume after a real restart, sort Most played after listens.

**Phase 7: share a playlist from one Music App to another, serverless** (L) — done, with these changes to the plan below:
- One id per track: **YouTube (9 bytes) > Apple Music (varint) > artist + title**. ISRC and Spotify ids dropped: a receiver without
  Premium or an Apple developer key can't resolve them, while text can be searched in the catalogs.
- Checksum = zlib's Adler-32 (deflate stream). Measured: 4 tracks = 57 bytes; 100 random YouTube ids < 1.2 KB (test).
- Shipped: QR (base45, read back from a dropped screenshot), `musicapp://playlist/…` link (Ctrl+V or typed in Add music),
  nearby 6-digit code (mDNS + SPAKE2 + ChaCha20-Poly1305, 5 tries, 10 min). Import: preview, then YouTube oEmbed, batched Apple
  lookup, catalog search; no YouTube quota used except for artist + title entries missing from Apple.
- Not done: remote wormhole words (needs your OK on the public relay), webcam scanning, clicking a `musicapp://` link in a browser
  (needs deep-link registration).

Original plan:
- **Compact binary `MA1` format**: header (version, name), then for each track the best available identifier.

  | Identifier | Size |
  |---|---|
  | YouTube (11 base64 characters) | 9 bytes |
  | ISRC | 8 bytes |
  | Apple Music (varint) | 5 bytes |
  | Spotify (22 base62 characters) | 17 bytes |
  | Local file only | title + artist in UTF-8 |

  Everything is compressed (deflate), with a checksum. Target: 100 YouTube tracks in under 1.2 KB, checked by a test.
- **Three ways to share**:
  1. **QR code**: base45 encoding, which is QR's alphanumeric mode, the densest. Shown in the app, and read by dropping
     a screenshot or image file (Rust decoding, `rqrr` crate). Webcam reading will come later.
  2. **"Grandma" short code**:
     - on the same network: 6-digit code à la LocalSend (mDNS announce, direct transfer encrypted by PAKE with the code as
       password);
     - remote: words to read out à la magic-wormhole (`7-guitar-storm`), end-to-end encrypted. It goes through the public
       magic-wormhole relay, a server that isn't ours: **to validate**.
  3. **Link or text** `musicapp://…` to paste anywhere (Ctrl+V, reuses link detection) for messaging apps.
- **Import**:
  - preview: N tracks, X already known, Y to look up;
  - matching by identifier, ISRC or title + artist + duration;
  - missing ones are looked up in the catalogs (reuses `add_track`, within the YouTube budget);
  - you get an editable custom playlist.
- **Tests**:
  - encode then decode gives the same;
  - size budget;
  - QR generated then read back;
  - wrong or altered code refused.

**Phase 8: personalized mixes, computed locally** (L) — done (`crates/core/src/mixes.rs`, `history.rs`), with these changes:
- History: `plays` (track, start, time actually heard, completed) and `track_prefs` (less / never), schema v2. Recorded by the player:
  natural end or 90 % = full listen, under 30 s = skip, under 2 s = ignored; seeking ahead doesn't count as listening.
- Shipped: Daily Mix 1–6 (label propagation on artists heard in the same session or picked into the same playlist), time-of-day
  mix, Rediscover (2+ full listens' worth, silent for 60 days), per-artist cap and no artist twice in a row, daily seed,
  "Less like this", "Never in mixes", history reset. Custom playlists count even with no history.
- Not done: genre / year tags (not stored yet), day-of-week affinity, Last.fm "Discoveries", Home sections (Resume, Your week).

Original plan:
- **Prerequisite**: a listening history. `plays` table: track, start, time listened, full listen or skipped. It also feeds
  Home (Resume, Your week).
- **Signals**:
  - plays and full plays (positive);
  - tracks skipped in under 30 s (negative);
  - freshness, with a 30-day half-life;
  - presence in your custom playlists (strong signal);
  - plays in the same session and shared playlists, which give a similarity between tracks;
  - affinity per artist, time of day and day of week;
  - file tags (genre, year).
- **Generated mixes**:
  - "Daily Mix 1 to 6": cluster your taste graph (artists that come back together, label propagation
    clustering). Each cluster gives a mix, ranked by affinity × freshness, with diversity (MMR, never two tracks by the same
    artist in a row);
  - "Rediscover": strong past affinity, not played for 60 days;
  - "Right now": by time of day;
  - "Discoveries" (optional): related artists via Last.fm (your key) then catalogs, with the YouTube version found automatically.
- **Control**:
  - one explanation per mix ("because you listen to X");
  - "less of this track", track exclusion, history reset;
  - everything stays local.
- **Tests**: fixed seed so reproducible results, signal weights, diversity constraints, no excluded track in a mix.

**"Go all out" bonus (pick)**: smart playlists (rules), listening stats, duplicate finder,
related-tracks radio (Last.fm key), Last.fm scrobbling, sleep timer, crossfade and equalizer (local files).
Set aside: lyrics (copyright).

## 4. Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
- No circumventing Premium or DRM. Quotas respected, no server of ours.

## 5. Risks to prototype first

1. DRM in WebView2: full Spotify and Apple playback in their official players. Probably blocked (Widevine not guaranteed);
   plan B (previews + YouTube) is in place.
2. YouTube search quota (100 a day): cache, batched searches, your own key.
3. Spotify link metadata without the API (oEmbed only gives title and cover).
4. Covers: shown from the services' APIs (YouTube, iTunes), cached locally.

## 6. Delivered mockups (Figma page "Music App v3 — Hi-Fi")

Mockups were drawn in French; the app itself is English by default.

1. `v3 / Accueil — Papier` (Home, Paper): Resume, Your week, Recently added, Your playlists sections; "Customize home" panel open.
2. `v3 / Morceaux — Papier` (Songs, Paper):
   - LED filters;
   - hover actions;
   - **right panel**: big cover, queue with multi-select, "True shuffle";
   - playlist folder;
   - deck with readout and knob.
3. `v3 / Playlist — Papier`: editorial header, round buttons, status line "21 in full · 3 as preview".
4. `v3 / Ajouter — Papier` (Add, Paper): search console (LED catalogs), pasted link, catalogs, drop zone.
5. `v3 / En lecture — Graphite` (Now Playing, Graphite): visible YouTube video, 01:12 readout, tuner scale, input selector, knob, queue.
6. `v3 / Réglages Apparence — Papier` (Settings › Appearance): themes, accents, covers, density, player, columns, live preview.
7. `v3 / Morceaux — Graphite perso` (Songs, custom Graphite): same screen with a custom theme (Graphite, yellow accent, vinyl covers, compact, Plays column).
8. `v3 / Thèmes — Papier` (Themes): gallery of the 7 themes, your themes, editor (colors, font, radii, LEDs, tint, contrast check).
9. `v3 / En lecture — Teinte pochette` (Now Playing, cover tint): the playback screen flat in the color of *After Hours*.
   The **Add** screen also got the OFFICIAL AUDIO and CLIP badges and the "Hide unofficial videos" filter.
