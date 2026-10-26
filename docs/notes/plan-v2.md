# Music App v2: plan

Status: **phases 1 to 8 delivered** (2026-10-17; phase 6 leftovers and live checks in "Still to do" just below). Earlier (2026-10-16): Hi-Fi redesign, themes, ad shield, custom playlists, local folders, add by YouTube link, Apple Music and YouTube search, one queue for every source with Apple previews, playlist sharing (link, QR, nearby code), local personalized mixes. Phase 6 (polish) under way: shortcuts, media keys, tray done; big round of player and library requests done (see "User requests 2026-10-16 (second session)"). Edit, strike or comment this file directly, or answer in the chat.
Mockups: Figma, file "Bow Game / Music App", page **"Music App v3 — Hi-Fi"**. The v2 "Apple" page is abandoned.

## Big update (2026-10-20, branch `big-update`)

**Delivered 2026-10-22**: every phase below done; what the final review left open is in
[review-2026-10-22.md](review-2026-10-22.md), the library incident in [health-check-2026-10-22.md](health-check-2026-10-22.md).

The user's big request of 2026-10-20, copied task by task. Work happens on the `big-update` branch (every green push to
`master` is a release: nothing goes to `master` without the user's OK). Phases run in this order; tick each line when
it lands (tested, `pnpm check` green, committed). Technical plan, rule changes and feasibility notes:
[big-update.md](big-update.md).

**Method**
- [x] Plan first: explore, then a detailed plan (order, approach per big task, rules changed, possible / impossible,
      risks). Unclear points: pick the most reasonable option, note it for the final report.
- [x] Dedicated branch `big-update`; nothing pushed to `master` without the user's explicit OK.
- [x] Every task of the request copied here as a checkbox.
- [x] After each task or small group: `pnpm check` green, app starts, nothing broken, small clear commit, tests for new
      logic (never real network).
- [x] User report 2026-10-21 (mid-work): a watch-page song restarted in Cover mode showed its video over the cover. Fixed
      (webview made hidden never started its media; placement asked before it existed was lost).
- [x] User report 2026-10-21 (later): opening or closing Up next moved the video's slot but not the video (it only
      recentered on a mode change). The slot now also watches its ancestors' size.
- [x] Final report: done / not done / not tested / choices made for the user / every rule changed (old, new, why).
      Given in the chat on 2026-10-22; rules changed: [big-update.md](big-update.md#rules-changed-summary-each-lands-with-its-code-docs-updated-in-the-same-commit).

**Phase 1: fixes**
- [x] Progress bar stuck: after a custom position set with our slider then a song change, the bar stops moving (setting
      it back to 0 unblocks it). Root cause + a test that reproduces it.
- [x] YouTube overlay: must never be visible over the player (shield's YouTube player script).
- [x] Sidebar in a small window: a scrollbar shows at the top right of the sidebar in the player (screenshot 3). The
      sidebar must not scroll there: cause + fix.
- [x] Cover auto-crop: black bars (and thin white edges) around video frames and covers (screenshot 4) detected and
      cropped so the picture fills its box, for covers and videos. Report if the cause is elsewhere.
- [x] YouTube import order: "added oldest" and "added newest" are inverted. Check, fix, test.
- [x] Search: use normal YouTube instead of YouTube Music only (rule "no YouTube key" changed if needed, method and
      risks in the plan). Hide videos that clearly aren't music, with "N videos hidden because they aren't music" (real
      count) and a button to show them.
- [x] Videos that "can't be played outside YouTube" (errors 101 / 150): detect the error from the player API; only
      then reload the video from its normal watch page in a webview with YouTube's interface around the player hidden
      (consistent with the overlay fix); invisible switch, our controls (pause, seek, volume, next) keep working, the
      next song follows normally; still unplayable (region, age…) → clean skip with a clear message. Official player
      only, no stream extraction.

**Phase 2: changes**
- [x] Up next: keep songs already played (don't remove them).
- [x] Optimization: memory, CPU, start time, smoothness of the app and the webview. Measure before / after, numbers in
      the report.
- [x] Keyboard shortcuts: custom shortcuts (skip, stop, play…) applied everywhere, including when the app runs in the
      background in the tray, with no conflict with Windows media keys. One table (`app/shortcuts.ts`), listed in
      Settings › Shortcuts.
- [x] Background: closing the window keeps the app running in the tray (screenshot 2), in a low-resource mode like
      Discord, back very fast; webview resources reduced while hidden, music never cut. "Quit" is the only real exit.
- [x] Auto-update: check at every launch; if an update is out, download in the background, restart automatically at a
      moment that doesn't cut the music, and resume playback where it was (`session.ts`).
- [x] "Music App" button goes Home, even from the player.
- [x] Window top bar follows the player's background instead of staying grey.
- [x] Click on the cover or the video: pause / play, with our own handling (not YouTube's).
- [x] Top bar: remove the sync icon and the back / forward icons at the top left.
- [x] Right-click on a song of a playlist or of the library: remove it from the playlists that hold it, or from the
      library (`features/menus.tsx`).
- [x] Music filter on YouTube import: leave out videos that aren't music, carefully (some real songs aren't tagged as
      music: when in doubt, keep).
- [x] Add music: play a song even if it isn't in the library.

**Phase 3: new features** (new default → bump `DEFAULTS_VERSION`, add to the settings search index)
- [x] Search bar like YouTube's in the navbar, always visible (screenshot 5): field + search button + mic button. Mic =
      voice search (speech to text, then search) and a way to start the Music Detector from it (simplest clear UI to
      pick one). If speech recognition can't be done cleanly in WebView2 without a server of ours: say so, propose an
      alternative, or keep only the Music Detector on the mic. Done: field, button, voice search (Windows' speech
      recognition, `speech.rs`), the mic's second choice opens the Music Detector.
- [x] Automatic translation: Windows language detected on first launch (supported → used, else English); language
      picker in settings; at least English and French; structure that makes adding languages easy; settings search
      works in every language.
- [x] Lyrics mode (Player mode): cover on the left, scrolling lyrics on the right, like Spotify. Client-side system or
      an API through Rust (LRCLIB to check): pick the best and justify.
- [x] Music Detector: a section under "Add music" that recognizes a song from sound (like Shazam), then adds it to any
      playlist. Pick a recognition service (user's key or free) and justify; clear microphone permission; no recording
      stored.
- [x] Windows quick commands: Previous, Play / Pause, Next under the taskbar thumbnail (screenshot 1), ITaskbarList3
      thumbnail toolbar; works on Windows 11, Play / Pause icon follows the state, follows the app's theme.
- [x] Cover animation: Advanced setting, cover grows and shrinks with the song's volume. Off by default. Uses live
      audio processing.
- [x] Adaptive Sound: Advanced setting, measures loudness and adjusts it to the user's target volume; a bar under the
      player's volume bar shows the adapted volume and its level. Uses live audio processing.

**Live audio processing** (shared by the Live Editor, Adaptive Sound and the cover animation)
- [x] Local files: processing in the native engine (`crates/player`, chain in `crates/dsp`).
- [x] YouTube: official player keeps playing the video; study per-process capture of the app's audio (WebView2),
      processing in the native engine, webview muted; feasibility, minimum Windows version, limits (latency, offset
      with the picture, CPU, speed / pitch for slowed) in the plan. Study done (big-update.md): processing runs inside
      the player instead (`captureStream` + Chromium's audio nodes, `crates/shield/src/live.js`).
- [x] Saved mixes hold parameters only (effects, values), never audio.
- [x] Spotify (protected playback) and Apple Music: what's possible or not, in the plan.
- [x] Can be turned off; if capture fails, back to normal playback with no error.
- [x] Same system for Adaptive Sound and the cover animation.

**Phase 4: big projects** (one by one, with the most care)
- [x] 4.1 Live Editor: edit the playing song live (slowed, bass boost, reverb…); save changes per song in local SQLite
      (`crates/core`), several mixes per song; several sections, one for 4D songs and where the sound comes from;
      best architecture, most advanced version, Audacity's techniques as inspiration (no code copied); works on
      YouTube songs (live processing); local files only: export a modified copy with the mix applied to a new file,
      original never touched (no export for YouTube, Spotify, Apple Music).
- [x] 4.2 Sync Mode: OneDrive detected automatically, ask the user whether they use it with encrypted files; another
      way to sync 2 PCs without a server of ours (nearby or an export file: propose, justify); everything synced
      (connections, settings, imported and non-imported local playlists); secrets never synced in clear (password
      encryption, or account list + sign in again); conflicts handled.
- [x] 4.3 Plugin system: real API for local third-party plugins that can change as much as possible and reach as many
      parts of the app as possible; manifest with declared permissions, user approval at install, isolated execution,
      no direct network or secrets (Rust gateway with permissions), API versioning; docs for plugin authors and an
      example plugin.
- [x] 4.4 Theme creator: better editor (`theme.ts`, tokens in `styles.css`), "Themes" and "Appearance" merged; a theme
      can change absolutely everything (except "Music App", its logo and legal notices): background images (adapt the
      image system and its security policy if needed), parts of the UX, etc. Settings search index updated.

**Phase 5: codebase health check**
- [x] Full check (report: `docs/notes/health-check-2026-10-22.md`): well kept, professional, maintainable over time, easy to change; CLAUDE.md, README and docs up to
      date and consistent with every changed rule; no dead code, no fake buttons; enough tests. Report with problems
      found, then fix the important ones.

**Phase 6: UI / UX / bug review by an agent**
- [x] When everything is done: one agent (Sonnet 5.5, high effort) with the most complete prompt to go through
      EVERYTHING: rate UI / UX as a daily user and as someone who loves practical interfaces, criticize without
      indulgence, performance report, overall report against the competition (Spotify, YouTube Music, Apple Music,
      Liner), every page, menu, setting and edge case. Full report handed to the user. Summary, fixes made after it
      and what stays open: [review-2026-10-22.md](review-2026-10-22.md).

**Phase 7: what the review left open, then the old points (user, 2026-10-22).** Then merge to `master` (user's OK given).
User's picks: mini player docked in the sidebar; Ctrl+S / R / P kept; YouTube sound processing on only when something
needs it; 2 s fade by default.
- [x] Defaults: 2 s fade (once, for those who kept 5 s), YouTube's sound processed only when an effect, Adaptive Sound or
      the moving cover needs it (already so: the setting is a permission; its text now says it).
- [x] Sliders: bigger hit area (3 px today), handle visible in the Live Editor.
- [x] Mini player docked at the bottom of the sidebar (never over the content); floating stays a choice (Appearance).
- [x] Text: Settings › Appearance › Text size (compact = before, normal ≈ 14 px body by default, large), rem sizes
      scaled by the root size, spacing and corners kept in px; 9 px labels raised to 10 px (11 at normal).
- [x] Settings: General / Playback / Appearance (playback settings out of Appearance, daily ones out of Advanced);
      Hi-Fi leftovers dropped or tucked away.
- [x] Lists: keyboard (one tab stop, arrows, Enter, Shift / Ctrl selection), multi-select with actions, drag and drop
      to playlists and within custom playlists, reorderable Up next.
- [x] Library: artists from YouTube channels cleaned ("- Topic", several artists), chips count what the page shows,
      sort by clicking column headers.
- [x] Music Detector without a personal token: AudD takes a few requests a day without one (checked live with a
      test tone 2026-10-22); a token of your own only once they are used up (#901).
- [x] Old points: Home sections show / hide / reorder; local folders watched; 50,000-track performance pass (Albums
      8 s → 0.4 s, Artists 2.3 s → 0.45 s, library load 157 ms); AA contrast (muted text on cards too); Spotify links
      over 100 songs (whole playlist with your own key, else said). Left to the user: back up the signing key
      (`~/.tauri/music-app.key`) somewhere safe.
- [x] Live Editor (user, mid-work): changes not saved as a version survive the app closing (back as they were).
- [x] Lyrics (user, mid-work): ♪ in the intro, instrumental parts and the outro; no big empty space above and below;
      the line being sung fills word by word as the song goes (karaoke), past lines dimmed.
- [x] Now Playing (user, mid-work): Auto / Video / Cover and Close player readable on any cover (theme background,
      blurred, behind them).
- [x] Lyrics of slowed / super slowed versions (user, mid-work, after the rest): timings too early; compare both
      durations to stretch them (`music_core::lyrics` already stretches: find why it didn't here, e.g. a 6:20 super
      slowed of a ~3 min song). Cause: stretch capped at 1.5× (super slowed is ~1.8×) and an unknown length trusted the
      original timings; now 0.4× to 2.6×, a slowed title waits for its length, cached answers made before are asked again.
- [x] Fix what's found, `pnpm check`, CI green on the three systems, merge PR #1 (merged 2026-10-22, phase 8 in PR #2;
      release v0.1.193).

**Phase 8: user's list, 2026-10-22 (screenshots of the installed app).**
- [x] Lyrics sometimes white and still: plain text was shown when the only synced records were a few seconds off the
      video (3:33 video, 3:28 records), or when the exact match had no timings. Synced records within 10 s fit, the
      lead artist is asked too ("A, B, C"), plain answers only when nothing synced exists; plain text follows the song
      and says "Not synced". Cache key v3.
- [x] Hidden videos: "Show" opens a fold listing them (play, drag, "It's music"), in Songs, imported playlists, mixes
      and Add music's search; right-click "Not music: hide it" / "It's music" (the user's word beats the guess).
- [x] Non-music left in Daily Mixes (Roblox scripting channels): old imports had no musicness stored, so today's rules
      now judge every YouTube track when the library is read (`music_core::musicness::judge`), talk / dev words, "how
      to" + a verb, channels mostly talk; mixes leave "not music" out.
- [x] Cover mosaics (playlists, mixes): fixed square tiles (`CoverGrid`), wide thumbnails no longer take more room.
- [x] Customize Home: cards dragged into place (Alt+↑ / Alt+↓ from the keyboard).
- [x] Drag and drop in Up next and playlists did nothing: Tauri's window file drop takes OS drags on Windows, so
      HTML5 drops never fired. Pointer drag instead (`shared/ui/drag.ts`): rows of custom playlists, Up next (also
      takes songs from any list), sidebar playlists, Home cards.
- [x] Sidebar mini player: a card tinted by the cover, progress line, play / pause; vinyl covers turn it into a record
      spinning at 33⅓ rpm with its arm (not for YouTube: its video stays visible, see docs/playback.md).
- [x] README: features.
- [x] README: new preview (`docs/images/songs.png`), from a demo library, not the user's own (v4 Songs page).

## Still to do (one list, updated 2026-10-23)

Everything still open, gathered from the sections below. Tick a line when it lands; details stay in their section.

**Release and updates** (the updater can't work until these are done)
- [x] GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (contents of `~/.tauri/music-app.key`), set 2026-10-17. The key has no
      password (checked by signing a test file) and matches the public key in `tauri.conf.json`.
- [x] Releases readable without sign-in: the repo is public (checked 2026-10-17).
- [x] Back up the signing key somewhere safe (done by the user, 2026-10-23) (lost key = installed copies never update again).
- [x] Automatic releases (2026-10-17): every push to master that passes `check` → `release.yml`, version
      MAJOR.MINOR (tauri.conf.json) + patch = commit count (`scripts/release.mjs`), notes = feat / fix / perf
      subjects, `[skip release]` to skip.
- [x] First release: installer + `latest.json` (v0.1.115, 2026-10-17; v0.1.193 the same, 2026-10-22).
- [ ] Update a real install from the previous version (e.g. v0.1.186 → v0.1.193), never seen live.
- [x] Before the first release: third-party notices in the installer, opened from Settings › About
      (`docs/licenses.md` › "Notices in the installer": `pnpm notices`, generated by `release.yml`).

**Repo quality** (2026-10-17, fourth session: user approved these four, in this order)
- [x] Add to playlist menu: each playlist's sidebar icon (asked mid-batch).
- [x] LICENSE-AUDIT: `docs/licenses.md`, `deny.toml`, `scripts/licenses.mjs`, `pnpm check:licenses`, CI job `licenses`.
- [x] DOC-OAUTH-ONBOARD: `docs/development.md` (tools per system, YouTube Music and Spotify sign-in, keychain, data).
- [x] CI-MATRIX: `check` job on windows, ubuntu and macos (`fail-fast: false`). First run green on all three (2026-10-17, run 38997865852).
- [x] Window comes back where it was closed: same screen, position, size, maximized / full screen (asked mid-batch). `window_place.rs` + tauri-plugin-window-state; driven live on a 3-screen setup (moved, maximized on screen 2, saved bigger than any screen, saved screen gone).
- [x] Open at startup (asked mid-batch): Settings › Advanced, HKCU Run entry listed in Task Manager › Startup apps, Task Manager's switch respected (`autostart.rs`). Refused in dev builds.
- [x] CONNECTOR-TESTS: CI runs `pnpm check` behind a dead proxy (no test can reach the network, checked with a probe); new tests: no session, 5xx retry then error, expired session, HTML instead of JSON, parsers on reshuffled answers, oEmbed refusals.
- [x] Performance (asked after Task Manager showed WebView2 at ~1.3 GB / 23 % CPU in `pnpm dev`): one shared clock for
      progress bars and times (was one 60 fps re-render loop each), hidden YouTube player at 200x200. Release build,
      Home while playing: WebView2 CPU 11.3 % → 1.8 %, layouts 225/s → 20/s. Measured over CDP
      (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`) on a copy with its own identifier.
- [x] Performance, next if needed: immersive backdrop drift still restyles ~280 times a second with Now Playing open
      (cheap, compositor); `pnpm dev` is much heavier than an installed build (React dev mode). Big update phase 2:
      `--drift` variable set 15 times a second, 252 → 33 style recalcs/s.
- [x] Logo and app name (top left) go Home.
- [x] New logo "Level M" (user's pick of 3): `src-tauri/icons/icon.svg` → every app icon (`pnpm tauri icon`), same M
      in the sidebar.

**Check live in the real app** (built and unit-tested, never driven for real)
- [ ] 2026-10-17 (fourth session): Open at startup from an installed copy (Task Manager › Startup apps shows it, its
      switch reflected both ways, starts at sign-in); window restore in the user's own `pnpm dev` (restart it first).
- [ ] 2026-10-17: add to a YouTube Music playlist from an album page (cause of `STATUS_FAILED` assumed = duplicates);
      YouTube overlay never shows (restart `pnpm dev` first: init script); toasts + Undo / Add anyway; reopen in Now
      Playing; advanced fade by ear (curves, fade on skip, fade on pause); Home's YouTube Music shelves on a real account
      (unofficial API, parser may need fixes); Home items not in the library (play, add to library); new mixes after real
      listening; cache rates in Settings › About; exact restore after an update.
- [ ] 2026-10-16 (second session): tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user
      owns, blocked video falling back, Auto on a real music video, resume after a real restart, sort Most played.
- [ ] 2026-10-16: repeat one / repeat all at a track's end, play next and add to queue, menu actions that write (rename,
      delete, export, remove from playlist), one-click play, start screen, local file covers, Apple cover backfill,
      Spotify covers, add another Google account, sign out.

**Phase 6 leftovers**
- [x] Performance pass with 50,000 tracks (big update phase 7).
- [x] Accessibility: AA contrast everywhere, full keyboard navigation (big update phase 7: AA contrast, lists by
      keyboard, focus in dialogs).
- [ ] Media panel off Windows.

**Features not done yet**
- [x] Home: show / hide / reorder sections (big update phase 7, Customize Home cards in phase 8).
- [x] Home: "Your week" (Phase 1 plan; Home v4 below).
- [x] Search bar v4 (user's pick 2026-10-23, Figma page "Search & Home — v4 proposal", points 1-7): one pill with the
      mic inside and the shortcut on keycaps; list under the field (library matches, YouTube suggestions, recent searches
      kept on this PC, "Search everywhere"); "In Songs" scope token (Backspace = everywhere); own Search page (type tabs,
      Everywhere / Your library, which services answered); Add music lost its second field.
- [x] Home v4 (same Figma page, points 8-12): chips All / Your library / YouTube Music, remembered, plus YouTube
      Music's moods when signed in (its home filtered by the chip); "Jump back in" (lists opened lately, this PC only,
      filled from what you played) instead of Shortcuts; songs as rows (Recently played, Recently added, YouTube Music's
      song shelves); Your week (time per day, top artist and song, from the play history); a ⋮ menu per section; signed
      out = one line at the bottom; Your playlists off by default (defaults v6).
- [x] App v4 (user's OK 2026-10-23, Figma page "App v4 — Full redesign proposal", points 1-15): compact headers;
      Songs (Play / Shuffle in words, playability pill, sorts remembered, Plays column, defaults v7); Playlist (actions in
      words, its menu for export / duplicate / delete, Songs that fit); Album (numbered, More by); Artist (most played,
      discography albums / singles, Radio); Now Playing (Up next · Lyrics · Sound tabs, remove from Up next, similar songs
      after the queue, setting autoplay); Settings (Reset off default, Accounts dot); sidebar playlist order + "+".
- [x] Album pages complete (2026-10-23): year, track numbers and discs, songs you don't have (dimmed, play, add),
      your other songs of it after; from the Apple catalog (`itunes::album`, keyless, cached a day), matched by
      `music_core::matching::album_slots`.
- [x] "Date added" as a real date (2026-10-23): schema v11 `added_at`, set for songs added from now on (older ones
      unknown, never guessed); optional Date added column.
- [x] Start radio from any song, sleep timer (15–90 min or end of song, 30 s fade), save the queue as a playlist.
- [x] Local folders: watch for changes (`notify` crate, `src-tauri/src/folders.rs`, big update phase 7).
- [x] Preview straight from search results (before adding): Add music plays a song not in the library (big update
      phase 2).
- [ ] Spotify previews.
- [ ] Mixes: genre / year tags (not stored yet), Last.fm "Discoveries" (user's key).
- [ ] Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
      clicked in a browser (deep-link registration).
- [x] Stats page (2026-10-23): time, listens, top songs / artists / albums, over time, time of day, weekday, days in a
      row, new artists; 4 weeks / 6 months / this year / all time, from the whole history (`play_history`).
- [x] Smart playlists (2026-10-23): rules on artist / album / title / source / plays / last played / newest added, every
      or any, sort and limit; kept in settings `smartLists` (synced), sidebar + menu, save as a normal playlist.
- [x] Motion (2026-10-23): page entrance, Now Playing rising, menus / dialogs growing, cover fade on a new song,
      press and hover lift; under 260 ms, transform / opacity only. Appearance › Animations turns all off; Windows'
      reduced motion = fades only.
- [x] Live Editor ranges much wider (2026-10-23): speed / tempo ×0.25–2.5, pitch ±24 st, bass / EQ 24 dB, echo 2 s.
- [x] Duplicate finder (2026-10-23): same title (packaging aside) + artist, other versions (live, remix, slowed…)
      apart; Songs page button, pick the copy to keep, merge one or all (`Library::merge_tracks`).
- [x] Last.fm scrobbling (2026-10-23): Settings › Accounts, user's own key + secret, allowed on last.fm; now playing and
      real listens (half or 4 min), offline ones sent later (memory). App tinted by the cover (option). Live Editor wider.
- [x] Polish round (2026-10-23): menus and the mic menu rendered in body (a transformed parent carried them off /
      gave scrollbars); hidden-videos list sized to its rows; Up next "38 / 1 292 played" + bar; sleep menu above
      its button; Your week card redone; F opens Now Playing (was Ctrl+P); language dropdown with drawn flags, other
      languages listed as coming soon; webviews keep full-speed timers hidden (slow song switch from the tray).
- [x] More right-click (2026-10-23): duplicate finder for any playlist / list / selection, repeated songs out of a
      custom playlist or Up next, copy song list / name, Up next panel, list header (columns, density, covers),
      settings rows (back to default), sidebar entries, hidden-videos fold.
- [ ] Real translations beyond French (the language menu lists them as coming soon).
- [ ] Bonus list (pick): equalizer (local files).

**Spotify** (no keys; user chose link import)
- [x] Playlists over 100 tracks (embed limit: only the first 100 come in). Big update phase 7: whole playlist with the
      user's own key, else the limit is said.
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: private playlists and Liked Songs (web session), ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [x] Dependabot alert #1, `glib` 0.18 (GHSA-wrw7-89jp-8q8g): Linux only, through Tauri's GTK3 stack (tao, muda,
      tray-icon); the Windows app doesn't contain it, nothing calls `VariantStrIter`. Fixed `glib` 0.20 is GTK4: no
      stable Tauri uses it (2.12.4 latest, 2026-10-17). Dismissed on GitHub (checked 2026-10-23); re-check at each Tauri
      upgrade.
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- [ ] Figma mockups still in French.
- [ ] Local only: `ui/dev/` preview harness (excluded in `.git/info/exclude`), delete when no longer useful.

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

**User requests 2026-10-17 (third session)** — done (what's left to check live: "Still to do" at the top).
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
- [x] Fade overlap (2026-10-26): YouTube → YouTube songs play together during the fade (X on the graph); local files
      still fade out, then in.
- [x] Update relaunch played nothing (2026-10-26): from the tray the page was never shown (Chromium holds its media),
      and songs not in the library (radio, similar songs) were lost from the saved queue.
- [x] Interactive preview for visual settings (background blur, dimming, motion, …): small live sample of the effect.
- [x] Artists and Albums: filter and sort, like songs in playlists.
- [x] Mixes: better algorithm, more mixes; covers as a 2×2 grid like playlists, setting in Advanced: grid / single
      cover / current template.
- [x] Smart cache in Rust for most of the app (memory + disk, invalidated on change).
- [x] Home: quick access to every section + recommendations (local mixes, then the connected services' own
      recommendations: YouTube Music home feed, Spotify if possible). Spotify: its recommendations API is closed to new
      apps since November 2024, so YouTube Music only.
- [x] Phase 6: auto-updates in the background, never cutting playback, install and relaunch at once (resume where it
      was); Settings › About: version, last update, update status.

**Phase 6: polish** (M) — started 2026-10-16
- Done: keyboard shortcuts (Settings › Shortcuts), media keys and the Windows media panel (title, artist, album, cover),
  written on the `windows` crate (SMTC) instead of `souvlaki` (would add an older `windows` version). Checked live: panel
  metadata and cover, play from the Windows session, Space, Ctrl+,, Alt+←. Mini player: done.
- Done after: tray icon (track, play/pause, next, previous, show, quit), seek bar in the Windows panel (checked live:
  position and length read back from Windows' session list).
- Not done: media panel off Windows.
- Done 2026-10-17: auto-updates (`tauri-plugin-updater`, background download, silent install at a quiet moment, exact
  restore), Settings › About (version, updates, app status, caches), release workflow on `v*` tags. Signing key made
  on the dev PC (`~/.tauri/music-app.key`, not in the repo). To publish: add the two signing secrets on GitHub and make
  releases public (the repo is private: the updater can't read private releases).
- Not done: performance pass (50,000 tracks), accessibility (AA contrast, keyboard navigation).

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
