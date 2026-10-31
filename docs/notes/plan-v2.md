# Legato: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign's steps, the user's choices along the way) is in git:
`git log -p docs/notes/plan-v2.md`, and in the release notes.

## Version 1.0: the redesign (branch `v2`)

Direction: [design.md](../design.md). Mockups: Figma file "Untitled" (every page in light and dark, the website too).
Version 1.0 (user's choice 2026-10-29: the first releases were 0.1). A new session starts with
[v2-handoff.md](v2-handoff.md).

- [x] Done on `v2`: palettes and defaults v8, layered panels, two-panel sidebar, right panel (Up next, lyrics, the
      mini player on top), song rows (artist column, heart, covers), page bands in the cover's tint, Now Playing, Up
      next in three blocks saved with the session, Home, Search, notifications setting, the mockup pass, motion, the
      website (`site/`), docs cleaned up.
- [x] Your library ↗ (open it full width, design.md) and a sidebar resized by its edge; the right panel's player only
      while something plays (user's ask 2026-10-30).
- [x] The player bar's "artist · from your file" line (the Source icon setting moved there).
- [x] Add music page rethought (one search, a card per way in); website and README shots taken from the real app
      with a demo library (silent public-domain MP3s with flat covers, scanned by a second dev app under its own
      identifier, other services linked with fake ids through `music_core::Library`).
- [ ] Check in the app: "No sound could be taken" gone from the second YouTube video on (fix 51946d5).
- [x] Website on GitHub Pages (user's choice 2026-10-29): Pages on, source GitHub Actions; `pages.yml` deploys `site/`
      from `master` at https://clovis500c.github.io/legato/ (first deploy with the merge).
- [x] Merge `v2` into `master` and push (= release v1.0.x), through `product-pass`.
- [x] Name: Legato, with Figma's brand (01 Brand: Roboto Black wordmark, the L on the playback blue), user's choice
      2026-10-29. The website uses it.
- [x] The app renamed Legato (user's go 2026-10-29): product name, window, top bar, About, texts in every language,
      tray, volume mixer, messages, app icon. Identifiers kept (CLAUDE.md). The installer finds an install by product
      name, so `src-tauri/windows/hooks.nsh` removes the old "Music App" one after the first Legato update (silent
      uninstall: app data kept) and `autostart::follow` points Open at startup at the new exe.
- [ ] Check on a real update from 0.1 (user's PC): Legato installed, old folder and its shortcuts gone, library,
      sign-ins and Open at startup still there.
- [ ] Discord shows "Listening to Music App": that's the name of the app on Discord's developer portal (rename it there).
- [ ] Trademark search for Legato (INPI, EUIPO, USPTO classes 9, 41, 42).
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).

## Product pass (branch `product-pass`, 2026-10-30)

Against Riff (rootscripts/riff: no login, one-click public playlist import): what a new user meets first.

- [x] graphify knowledge graph for Claude Code (code only, local AST; CLAUDE.md › graphify). Git hooks not installed
      (the auto mode refused persistence): the user may run `graphify hook install`, then drop the `.gitattributes`
      line it adds (the graph isn't tracked).
- [x] Signed out works: song searches fall back to YouTube Music's public catalog (`AppState::ytm_or_public`); a
      Spotify link import plays (checked: Random Access Memories, 13 of 13 playable, no Google account).
- [x] First-launch welcome (`features/welcome`): what Legato keeps on this PC, then folder / YouTube Music / link /
      search; Home shows the same cards while the library is empty; About links "What leaves your PC".
- [x] Offline: nothing blocked or skipped, the song starts again when the network is back; Offline in the top bar;
      network errors in plain words (`shared/errors.ts`). Stuck check armed for the first YouTube song too.
- [x] Untagged local files named by their file name ("01 - Artist - Title"): they link across services.
- [x] Two songs at once (user's report 2026-10-30): the overlap's old song never faded (YouTube sends a video's length
      once, the tail read it from each report) and played on at full volume under the next one. It fades out to its
      song's end now and stops there; a learned early end ends the song without a crossfade too. Checked in a dev build
      (8 s crossfade, both embeds' volumes sampled).
- [x] Links after the repo's rename to `legato`: Discord's "Get App On GitHub" button, updates, LRCLIB's agent, the
      website's base path (its styles and scripts were 404 at /legato/: live once merged).
- [ ] Check on a real network cut (Wi-Fi off while a YouTube song starts): paused, one message, restarts on its own.
      Only emulated so far (DevTools cuts the page, not YouTube's out-of-process frame).
- [x] "Unknown artist" is an English word stored in the library (`local::read`): show it translated (`shared/artistName.ts`; the
      media panel, Last.fm, Discord, copied text and the data keep the stored word).
- [x] Merge `product-pass` into `master` and push (= a release): PR #10, e0c63b8.

## Best in class (user's ask 2026-10-30)

What a listener would get, against Riff (rootscripts/riff: Electron, yt-dlp downloads, YouTube / SoundCloud, imports
from Spotify / Apple / Deezer) and the best players overall (Spotify, Apple Music, MusicBee, Plexamp, foobar2000,
Cider). Already ours and kept as selling points: legal playback (no downloads), Tauri (light), Sync Mode between PCs,
Last.fm, Music Detector, Live Editor (10-band EQ, tempo, pitch, reverb, space), smart playlists, stats, mixes, sleep
timer, synced lyrics with offset, visualizer, themes + own CSS, plugins, Windows media panel, global shortcuts, many
languages. Rules unchanged: nothing on this list downloads, records or exports a platform's audio, and no server of ours.

Each line below is detailed (what the user sees, how, rules, effort, done when) in [ideas/](ideas/README.md).

### Roadmap (order to build in; effort S = one session, M = a few, L = many)

Pick from the top. Each milestone is one release on the Stable channel; workflow items that unblock others go first.

| # | Milestone | What lands | Effort | Why now |
|---|---|---|---|---|
| 0 | Groundwork | Release channels Beta / Stable, generated IPC types, local diagnostics log, `pnpm bench` numbers (done 2026-10-30), E2E smoke test (done 2026-10-30) | M | Every later step is safer and faster |
| 1 | First impression (1.1) | Deezer + Apple Music link import, "Why Legato" page with measured RAM, Unknown artist translated, cover cache cap, lazy pages, deferred startup | M | What a Riff user tries in the first minute |
| 2 | Sound and sight (1.2) | Visualizer v2 (data, canvas renderer, LED bars, radial, VU, spectrogram, full screen), karaoke mode, precise volume, skip silences, SponsorBlock music_offtopic | L | The most visible gap, and the most shareable |
| 3 | Lyrics (1.3) | Word-by-word lyrics, translation, find by a line, lyrics saved into files and tapped live | M | Riff and Cider's most loved screen |
| 4 | Your own music (1.4) | Jellyfin / Navidrome / Subsonic, ReplayGain, batch tag editor + MusicBrainz, ratings, column view, ListenBrainz, playlist folders | L | MusicBee / foobar / Plexamp users switch for this |
| 5 | Smart (1.5) | Local sonic analysis, song / artist radio, sweet fades, path between artists, auto-DJ, smart shuffle, Wrapped | L | What no free desktop app does without a server |
| 6 | Around the house (1.6) | Phone remote, cast (DLNA / Chromecast), listen together on the LAN, pick up on the other PC | L | Turns a player into a home system |
| 7 | Windows polish (1.7) | Command palette, taskbar buttons + Jump List, headphones / call pause, alarm, OBS overlay, PiP, drag from Explorer | M | Small, many, each a reason to stay |
| 8 | Everywhere (2.0) | macOS and Linux builds, Android companion | L | Riff's one platform lead |

Kept apart (need the user's call or an outside step): Spotify playback paths, LLM playlists with a user key, SoundCloud
playback (its terms), concerts (an API's terms), trademark search.

### Done when (top items)

- **Release channels** (done 2026-10-30, code side): Settings › General › Updates shows Stable / Beta; a push to master reaches
  Beta only; a manual workflow promotes to Stable; `latest.json` per channel; switching to Stable never downgrades.
- **Generated IPC types** (done 2026-10-30): `shared/api.ts` imports types written by a Rust build step; CI fails when
  they differ; no hand-copied struct left.
- **Diagnostics**: rotating log in the app data folder (errors, warnings, playback switches; no titles unless the
  user opts in); Settings › About › Copy diagnostics; nothing sent.
- **Bench** (done 2026-10-30): `pnpm bench` prints cold start, first paint, RAM after 1 min playing and after 10 min in the
  tray, idle CPU, on 10 000 local songs (a generator, `crates/core/examples/bench_data.rs`, not a folder); numbers kept in
  `docs/performance.md`. Left: YouTube playback isn't measured (it needs the
  network); not in CI yet. The release build needs `pnpm notices` once per clone: the bench checks for the file first
  and says so (review fix, 2026-10-30).
- **E2E smoke** (done 2026-10-30): `pnpm e2e` builds a debug app with the `e2e` cargo feature (own identifier, network on a
  loopback mock, silent audio output), then drives its real window over WebView2's DevTools port: the welcome comes first,
  a demo folder of three WAV songs is added and scanned, a song plays 3 s and the engine's position moves, Pause / Play,
  a search answered by the mock (suggestions, YouTube, YouTube Music, Apple) while the song plays on, quit with exit code
  0, relaunch (no welcome, library kept); about 15 s once built. A new `e2e` job in `check.yml` runs it on Windows,
  screenshots and a report as artifacts on failure. Left: the job has not run on GitHub yet (nothing was pushed): the
  first runs may need tuning, so it does not block yet (`continue-on-error`, a warning on a failure: `release.yml` waits
  for a green `check`); delete that line in `check.yml` after a few green runs. The real audio device, the YouTube embed
  and the native folder picker (answered over DevTools, not driven) are outside it. Review fixes (2026-10-30): `--shots`
  can name any folder, so a walk removes only its own files there, never the folder; a refused install in a dev build
  leaves the Ready state.
- **Deezer / Apple link import** (done 2026-10-31): pasting a Deezer or Apple Music playlist / album URL in Add music (or
  the search box, or Ctrl+V) imports it like a Spotify link, with the matched count shown ("12 of 13 songs found");
  mockito tests on recorded answers; the website's privacy rows name the hosts. Choices: the songs land in a new
  playlist of yours (no new library source: older versions of Sync Mode would not read it); Apple playlists show about
  100 songs at most on the page (the toast says when the list is longer). Checked for real against a 153- and a
  200-song Deezer playlist and Apple's editorial and users' playlists (a throwaway caller, not CI). Short links
  (`link.deezer.com`) are tested on a recorded 302 only: no real one was at hand. Details: `docs/playback.md`.
- **Smoke test: pasted links and the ready signal** (done 2026-10-31): the walk's `links` step types a Deezer playlist link in
  Add music and pastes an Apple album link (Ctrl+V), answered by `e2e/mock.mjs` from the connector fixtures and a song search
  that finds one song of each list; it checks the progress toast, Cancel, the found count, the playlists and the library
  count. The diagnostics log says what started the deferred work; a walk fails on the 8 s timer. Broken on purpose once
  (the Deezer link recogniser): the step fails. About 17 s.
- **Why Legato page** (done 2026-10-31): a section on the website with the 2026-10-31 bench row's numbers and the four differences (legal, light,
  Sync Mode, Last.fm), no competitor named; the site has one language (English), so one copy. Numbers in `BENCH` of
  `site/components/content.tsx`: change them with each new row of `docs/performance.md` (the README line too). Not
  deployed: Pages deploys from master only.
- **Cover cache cap and thumbnails** (done 2026-10-31): the `art/` folder (only the cache writes there; `covers/` with
  playlist pictures and theme backgrounds is another folder and never pruned) stays under a cap, 500 MB by default
  (Settings › General › Cover cache: 250 MB to 2 GB, current size, Clear covers; per PC, not synced). Least recently
  used out down to 80 % of the cap, on a thread of its own at launch (deferred start) and after writes that pass the cap;
  a file's modified time is touched at most once a day on a read. Lists ask `art://…?s=64|256|600` (`shared/art.ts`
  `sizedArt`, picked in `Cover` from the drawn size × the screen's density; the big cover and video-bar detection keep
  the full picture or at least 256): cut once from the cached original on a worker thread, two at a time, kept as
  `<key>.<size>`, short edge = the size, ratio kept, never enlarged; a failed cut (GIF, WebP) serves the original. Local
  files' covers are cut in memory only (the file can change). Rules and tests: `crates/core/src/artcache.rs`. Left:
  WebP and GIF originals are not cut (the `image` crate here has PNG and JPEG only: the hosts send JPEG); the
  10 000-song scroll was not measured in the running app, only tested in Rust.
- **Visualizer v2 first cut**: 1/6-octave bands at 60 Hz from both twins (tests: a sine lights its band in Rust and JS
  alike), one canvas renderer, four looks (LED bars with peaks, radial around the cover, VU needles, spectrogram), full
  screen on F, under 3 % CPU on the bench PC, reduced motion respected.
  (All 3 steps landed 2026-10-31: the frames, the worker's canvas with LED bars and full screen on V, then radial, VU
  needles and spectrogram. CPU measured with `pnpm bench --visualizer`: at 60 fps drawing 5 of 16 looks and sizes were
  over 3 % (up to +4.6 points of the PC), drawn at 30 fps the four looks run again are +1 to +1.9 (`docs/performance.md`).
  Full screen is on V, not F (F stays Now Playing). Left of the whole Visualizer v2 list: weighting, beat, 1/3 and 1/12
  octave, loudness, oscilloscope and the rest, in the lines above.)
- **Karaoke mode**: full screen, current line large, next lines dimmed, the blurred cover behind, offset keys, exits
  on Esc; works with plain lyrics as a scroll. (Done 2026-10-31.)

**1. Catch up with Riff (what a Riff user would miss)**
- [x] Paste a Deezer playlist / album link: imported like a Spotify link (Deezer's public API, no key). (2026-10-31)
- [x] Paste an Apple Music playlist / album link: iTunes lookup for albums, the page's data for playlists. (2026-10-31)
- [ ] Paste a SoundCloud link: imported; plays in SoundCloud's official embedded widget (no audio taken).
- [ ] SoundCloud search beside YouTube's (widget playback, its terms checked first).
- [x] Karaoke / TV mode: full screen, big synced lyrics over the blurred cover, line by line. (2026-10-31: K, buttons on the lyrics panel and Now Playing, right-click menu; the mock has no lyrics, so the walk checks the calm message only. Not done: a long-song 60 fps check on the bench PC, word-by-word timings.)
- [ ] Lyrics translation in the panel (a service sends text: add the website's privacy row first).
- [ ] Dynamic colour from the cover across the whole app, not only page bands (a Theme Studio choice).
- [ ] Squiggly / waveform progress bar as a progress style choice.
- [ ] More visualizers (rings, wave, mirrored bars) and a full-screen one.

**2. Beat Riff (things it can't or won't do)**
- [x] "Why Legato" on the website: legal, light (measure our RAM and say it), Sync Mode, Last.fm, no telemetry. (done 2026-10-31)
- [ ] Personal servers: Jellyfin, Navidrome / Subsonic, Plex (the user's own music, streamed legally, keychain login).
- [ ] Cast: DLNA / UPnP speakers and Chromecast for local files and personal servers.
- [ ] Listen together on the local network: one PC leads, the others follow (Sync Mode's code, no server).
- [ ] Phone remote: a page served on the LAN (QR code) to pause, skip, see the queue (Plexamp-like).
- [ ] Tag editor (one file already: right-click › Edit song info, `src-tauri/src/tags.rs`): several files at once,
      track numbers, year, genre, MusicBrainz lookup that fills them.
- [ ] ReplayGain / loudness normalisation for local files (reads the tags, or measures once and stores it).
- [ ] Equalizer presets per output device (headphones vs speakers) and AutoEQ profiles for known headphones.
- [ ] Exclusive WASAPI output / bit-perfect for local files (foobar's audiophiles).
- [ ] Gapless + crossfade that knows albums (never crossfade inside a live or continuous album).

**3. Best overall (what the big ones have)**
- [ ] "Wrapped": a yearly / monthly recap from our stats, shareable as a picture.
- [ ] Artist / album / playlist radio and endless autoplay (song radio already there: `radio.ts`).
- [ ] Smart shuffle (skips recently played, spreads artists) and "Daylist"-style mixes by time of day.
- [ ] Genre / year / BPM / key tags stored (mixes, smart playlists, DJ-like transitions by BPM).
- [ ] Podcasts by RSS (open feeds only: no platform audio taken), resume per episode, speed.
- [ ] Internet radio stations (Radio Browser's open directory).
- [ ] Release radar: new releases from artists in the library (YouTube Music / MusicBrainz).
- [ ] Concerts near the user from followed artists (a public API with no account; privacy row).
- [ ] Mobile companion (Android first): the library from Sync Mode's folder, remote control.
- [ ] macOS and Linux builds (media panel, detector, tray per OS).
- [ ] Accessibility pass: full keyboard, screen reader labels, contrast AA everywhere, reduced motion.
- [ ] Onboarding import from other apps: MusicBee / iTunes library XML, Spotify / YouTube likes in one go.

**4. Small things nobody else does well on Windows**
- [ ] Command palette (Ctrl+K): any song, page, setting or action in one box.
- [ ] Jump List (recent playlists, Shuffle all); thumbnail buttons already there (`thumbbar.rs`).
- [ ] Pause when headphones are unplugged or Bluetooth drops; pause during a call (Windows' communication ducking).
- [ ] Pick up on the other PC: Sync Mode carries "now playing + position", one click resumes there.
- [ ] Alarm: wake up with a playlist (fade in), works from the tray.
- [ ] Focus / workout sessions: a timer, no-lyrics or high-BPM mix, a summary after.
- [ ] Now-playing overlay for streamers (a local page OBS can show, the app's theme).
- [ ] Drag files or folders from Explorer onto the window: added (or played with Shift).
- [ ] Find a song by a line of its lyrics (LRCLIB search), and hum to search if AudD's free tier allows it.
- [ ] Credits and artist pages: who wrote / produced (MusicBrainz), a short bio (Wikipedia), links out.
- [ ] Playlist folders, pinned playlists, generated playlist covers (a 2×2 of the songs' covers).
- [ ] Same loudness across sources: YouTube vs local vs Spotify levelled by the Adaptive Sound meter.
- [ ] Backup / restore the whole library to one file (playlists, likes, edits, stats), outside Sync Mode.
- [ ] Hide explicit songs (a filter, YouTube Music's flag when there is one).

## Visualizer v2 (user's ask 2026-10-30: more realistic, more detailed)

Today (`Visualizer.tsx`, `bars.ts`, `crates/dsp` `spectrum.rs`, `live.js` `bands()`): 16 band-passes half an octave
apart, ~50 ms mean square, polled at ~30 Hz (`player_levels` invoke; YouTube in each report), drawn as 16 DOM bars in
a 48 px strip under the cover; four looks (bars, mirror, peaks, wave). Coarse (16 bands), mono, no time-domain
signal, no beat, small. Plan: better data first, then a real renderer, then the styles.

**Data (both twins alike: `crates/dsp` and `live.js`)**
- [x] FFT spectrum (Hann window, 4096 points at 48 kHz, ~85 ms, 50 % overlap) mapped to log bands: 1/3, 1/6, 1/12
      octave (31 / 62 / 120 bands, 20 Hz to 20 kHz), ANSI centers; `live.js` reads the same from its analyser bins.
      (2026-10-31, step 1 of 3 of the first cut: **1/6 octave only, 61 bands** 19.95 Hz to 19.95 kHz, Hann here, Blackman
      in `live.js` calibrated by its energy; 1/3 and 1/12 left. Under ~320 Hz the bands are narrower than the window
      sees: a sine reads right, neighbours read high. Details and what the tests promise: `docs/playback.md`.)
- [ ] Weighting (A or ITU-R 468) and a +3 dB/octave tilt option, so music looks level instead of bass-heavy.
- [ ] Stereo: left and right bands separately; time-domain blocks (L/R, 1024 samples) for scope and vectorscope.
      (Left / right bands, rms and peak done 2026-10-31; the time-domain blocks left.)
- [ ] Beat and onset detection (spectral flux on low and mid bands, tempo estimate): kicks drive pulses, flashes, camera.
- [ ] Loudness stream (momentary / short-term LUFS, true peak) already measured by Adaptive Sound: exposed for meters.
- [x] Push, not poll: a Tauri `Channel` at 60 Hz with a compact binary frame (bands as u8, samples as i16); only while a
      visualizer is on screen; the front end interpolates between frames.
      (2026-10-31: `viz_start` / `viz_stop`, worker only while subscribed, `features/player/vizFrames.ts` for both twins;
      bands and levels as u8, no samples yet; the interpolation is the renderer's, step 2. Nothing subscribes yet; the
      old 16-band strip still runs, what can go then is listed in `docs/playback.md`. CPU of the stream on the bench PC
      not measured.)
- [ ] Unit tests: a sine lights its 1/12-octave band, a pink noise reads flat with the tilt, a click track gives its BPM.
      (Comfort: a 10 Hz strobe flashes at most 3 times a second after the limiter, done 2026-10-31.)
      (Sine in its 1/6-octave band, left-only, twins on a shared fixture: done 2026-10-31.)

**Renderer**
- [x] One `<canvas>` (Canvas 2D first, WebGL2 for the heavy looks) in an OffscreenCanvas worker: no React, no layout;
      pauses when hidden, 30 fps cap on battery, devicePixelRatio aware.
      (2026-10-31, step 2 of 3: Canvas 2D in a worker, paused when hidden / off screen / not playing; the 30 fps cap on
      battery left. Details: `docs/playback.md` › Visualizer renderer.)
- [ ] Sizes: the strip under the cover (today), a big backdrop behind Now Playing, full screen (F), the mini player,
      the OBS overlay page; a click on the visualizer cycles its look.
      (Strip and full screen done 2026-10-31: V and a double click, F stays Now Playing; right-click picks the look, a
      click does nothing as before. The backdrop, mini player and OBS page left.)
- [ ] Colours from the theme or the cover (`coverTint.ts`): gradient along frequency, by level, or the cover's palette.
      (2026-10-31: the theme's text colour as read where it is drawn, so Now Playing's cover tint applies; no colour
      choices yet.)
- [x] Visualizer v2 review fixes (2026-10-31): the VU reads the frame's window RMS (the bands overlap under 300 Hz and
      read 5 to 9 dB hot), a silent frame is silence (the loop stops), the native levels poll no longer runs for the
      visualizer, search / settings / back do nothing behind the full screen and Esc leaves from a hidden field, a
      `viz_start` from the page before a reload is dropped (`viz_page`), the spectrogram is the theme's ink with
      opacity (no hues). Left: a multi-hue spectrogram look as an opt-in.
- [x] Reduced motion: slower, no flashes (Windows' animation setting); a flash limit always (photosensitivity).
      (2026-10-31: `prefers-reduced-motion` and the app's Animations setting; the flash limiter is tested on a strobe.)

**Styles (each with a few settings: bands, smoothing, peak hold, colours, mirror, reflection)**
- [ ] Spectrum bars, realistic: 1/3 to 1/12 octave, LED segments, peak caps that hold then fall with gravity,
      reflection on a glossy floor, frequency and dB scales on hover.
      (LED segments with held, falling caps done 2026-10-31, 1/6 octave; the reflection, the scales and the other band
      counts left.)
- [ ] Smooth spectrum curve (filled area, glow), stereo overlay (left and right in two colours).
- [x] Radial spectrum around the cover (the cover in the middle pulses with the kick, bars around it).
      (2026-10-31, step 3 of 3: mirrored bars on a ring behind a round cover in Now Playing where the stage is >= 330 px
      and the art square, around the cover in the full screen, bars in the strip; the pulse is Moving cover's own, no
      beat detection yet. `docs/playback.md` › Radial, VU needles, spectrogram.)
- [x] Analogue VU meters: two needles with real ballistics (300 ms VU, PPM option), peak LED, a skin from the theme.
      (2026-10-31: VU ballistics tested (99 % in 300 ms, 1.24 % over), peak LED held 1 s, the theme's ink and danger red;
      left: the PPM option and other skins.)
- [ ] Loudness meter: LUFS bars (momentary, short-term, integrated), true peak, dynamic range of the song.
- [ ] Oscilloscope: the waveform, triggered on zero crossings so it stands still, phosphor afterglow.
- [ ] Vectorscope / goniometer (left vs right, Lissajous) with a correlation meter: stereo width at a glance.
- [x] Spectrogram: scrolling waterfall, colour maps (magma, viridis, the theme), log frequency axis.
      (2026-10-31: Canvas 2D, one magma-like map, fixed 90 px/s whatever the refresh rate; left: the other maps, WebGL.)
- [ ] Spectrum 3D: a terrain of the last seconds flying towards the camera (WebGL).
- [ ] Particles on the beat (from the cover's colours), with the cover's blur behind (Plexamp-like backdrop).
- [ ] Song waveform on the progress bar for local files (computed once from the file, cached; not for streams).
- [ ] Preset engine, written from scratch: equations per frame / per vertex driven by bands and beat (MilkDrop-style
      ideas), presets as small JSON shared like themes; `.milk` files the user owns loaded if a reader stays simple.
- [ ] Visualizer API for plugins (`crates/plugins`): a plugin gets bands, beat and loudness, draws with a restricted
      2D canvas command list (no raw access).

## Ideas loved in independent players (checked against our rules)

- [x] Skip a music video's non-music parts (intros, skits, outros) from SponsorBlock's community segments
      ("music_offtopic"; its public API, privacy row first). YouTube Music desktop's most used plugin.
      Done 2026-10-31, off by default (a new third party gets a hash prefix per video: the user opts in; flip the default
      if wanted). Limit: only the music_offtopic category; no vote or lock filtering of segments (the API gives none we use).
- [x] Skip silences at the start and end of songs (local: measured; YouTube: from the live meter).
      Done 2026-10-31, off by default. Limits: YouTube's start is learned (the first play of a video can't know where its
      music begins; the next play seeks once); a trimmed local end hands over through a normal next (no gapless chain
      across it); only the first 4 files of a run are measured ahead.
- [x] Precise volume: mouse wheel on the player bar, 1 % steps, a volume number shown; per-source volume memory.
      Done 2026-10-31 (wheel on the bar, full screen controls, sidebar and floating mini players; Shift 5 %; Ctrl+Up / Down
      already rebindable). Not done: a perceptual (dB) curve (it would make every saved volume louder or quieter; local and
      YouTube stay level because both are linear), and per-source volume memory (needs its own setting and a switch
      rule: its own line if wanted).
- [ ] Word-by-word lyrics when the source has them (enhanced LRC), background vocals apart, Apple-style animated lines
      (Cider, Spicetify's Beautiful Lyrics).
- [ ] Sweet fades (Plexamp): crossfade length picked per pair from the songs' ends (loudness, silence, tempo).
- [ ] A path between two artists (Plexamp's "Sonic Adventure"): a mix that walks from one to the other.
- [ ] Guest DJ-style picks between songs ("because you liked …"), local and explainable, no cloud.
- [ ] Auto-DJ that keeps the queue going from the library with rules (MusicBee).
- [ ] Album / artist colour theme: the whole app takes the playing cover's colours (YouTube Music desktop, Cider).
- [ ] Picture-in-picture: the video or cover floating above other windows, small controls.
- [ ] Classic skins: a compact "mini" layout (Winamp-like) with the user's theme; a column view of the library with
      chosen columns, sorts and groupings (foobar2000, MusicBee).
- [ ] Lyrics saved into local files and editable (Guayadeque, MusicBee): fix a line, timing tapped live.
- [ ] Scrobble to ListenBrainz too (open, no key), beside Last.fm.
- [ ] Rating with stars or half stars (local and synced), smart playlists on it.
- [ ] Sonic analysis, ours and local: features (tempo, key, energy, brightness, mood) computed from local files, and
      from what plays live for streams (the meter already listens; measured, not extracted), stored per song. Feeds
      "similar songs", song radio, sweet fades, the path between artists (Plexamp's Sonic Analysis needs a server).
- [ ] Describe a playlist in words ("calm rainy Sunday, no lyrics"): matched against the library's tags and sonic
      features locally; an LLM only with the user's own key (like Last.fm's), privacy row first.
- [ ] Bookmarks inside a song (a moment to come back to, a note), Spicetify's Bookmark.
- [ ] Practice mode for musicians: A-B loop, slow down without pitch change (Live Editor has it), key and chords shown,
      count-in / metronome on the song's tempo.
- [ ] Full cover display: the cover alone, huge, title and progress over it (Spicetify's Full App Display); a clock
      option, for a second screen.
- [ ] Discovery from open sources: new releases of followed artists, community picks (r/listentothis' public JSON),
      shown as cards to play from YouTube.
- [ ] "Aural fixations": songs you played a lot at one time of your life, brought back (from our own history).

**Last batch: areas not covered above (after this the list stops growing; ideas come from real use)**
- [ ] Long YouTube mixes and DJ sets split by their chapters (or timestamps in the description / pinned comment):
      each part a song in Up next, skip within the video; Music Detector names unlabelled parts on request.
- [ ] Audiobooks from local files (m4b chapters, resume per book, speed, sleep at chapter end), apart from music.
- [ ] Playlists in and out as files: M3U / M3U8 / XSPF / CSV import and export (paths for local, links for streams).
- [ ] Library health: missing files, YouTube videos gone private (with "Find another version", `alternative_videos`),
      songs without covers or tags, one page to fix them.
- [ ] Output devices: switch from the player bar, remember per device (volume, EQ preset), follow Windows' default.
- [ ] Sleep timer "at the end of this album" ("this song" exists) and a fade over the last minutes.
- [ ] Profiles on one PC (each person's library, likes, history and Last.fm), switched from the top bar.
- [ ] Living-room mode: big UI driven by a gamepad or the arrow keys (10-foot layout), for a PC on a TV.
- [ ] Stream Deck plugin and an Xbox Game Bar widget (play / skip / like / now playing) over the local hotkeys.
- [ ] Voice control beyond search: "next", "like this", "play my running playlist" (WinRT speech already there).
- [ ] Blind test game: snippets from the library or a playlist, guess title / artist, scores, local multiplayer
      on one screen or over the LAN code.
- [ ] Share a song as a picture card (cover, title, a lyric line, the theme's colours) for social apps.
- [ ] Theme and plugin gallery without a server: an index file in a GitHub repo, browsed from Add-ons, installed after
      the usual permission review; authors submit by pull request.
- [ ] Privacy page in the app: every host Legato talked to today and why (from the Rust gateway's log), matching the
      website's rows.
- [ ] Right-to-left languages (Arabic, Hebrew: mirrored layout) and community translations (Weblate), more languages.
- [ ] Community: a Discord server or GitHub Discussions linked from About, "good first issue" labels, a showcase of
      themes on the website.

## Workflow (how we build it)

Today: every green push to master is a release (369 so far, check 5-11 min then release 13-18 min); no end-to-end
tests; `src-tauri/src/lib.rs` 2068 lines; CLAUDE.md ~12 kB read by
every session.

- [x] Release channels: Beta (every green push, a prerelease, opt-in in Settings › General › Updates) and Stable (the
      `promote` workflow by hand), so a bad push never reaches everyone. Limits: no tag trigger or weekly schedule; the
      workflows have not run on GitHub yet (after the merge, check that the `beta` release appears and that
      `releases/latest` still serves Stable); until the first promote, Stable PCs stay on the last pre-channels release.
- [ ] Release notes written from the commits (feat / fix grouped, in the user's words), shown in the app after an update.
- [x] Generated TypeScript types from Rust (`ts-rs`, `pnpm types` → `ui/src/shared/generated`) for every IPC type: no
      hand copies, CI diff check on the Windows job. Limit: the `invoke` wrappers in `api.ts` stay by hand (no
      `tauri-specta`), so a command's name and arguments are still checked by eye.
- [ ] Split `src-tauri/src/lib.rs` by feature (library, player, accounts, sources) like `detector.rs` / `editor.rs`;
      same for `crates/core/src/library.rs` (queries per table).
- [x] End-to-end smoke test on Windows CI: launch, welcome, scan the demo folder, play a local song, search signed out
      (mocked), quit. Catches what unit tests can't (the "two songs at once" class). Done 2026-10-30 (`pnpm e2e`, the
      `e2e` job, docs/development.md), over the DevTools port with `scripts/cdp.mjs`, no tauri-driver: no driver version
      to pin (msedgedriver breaks on WebView2 133+ on the runners, runner-images#14738). Green on GitHub since 2026-10-31.
      Left: no YouTube embed (needs the network), no real audio device.
- [ ] The "Check live in the real app" list as a scripted checklist (a dev-only page that drives each step and logs the
      result), so a pass takes minutes, not a session.
- [x] Crash and error log kept locally (rotating file, Settings › About › "Copy diagnostics"): bug reports with facts,
      nothing sent. Limit: a crash that ends the process without a Rust panic (a native fault, a kill) leaves no line;
      Windows' event log and minidumps are not read.
- [ ] Faster CI: run the macOS job only on pushes that touch Rust or `src-tauri`, `cargo nextest`, `sccache`; Linux
      job stays crates only.
- [ ] `graphify hook install` (the user's go) so the graph stays fresh without asking.
- [ ] Trim CLAUDE.md to rules + pointers (structure details move to `docs/architecture.md`): cheaper sessions.
- [ ] Project skills for Claude Code: "release check", "add a setting" (schema, DEFAULTS_VERSION, search index, i18n),
      "add a connector" (module, mockito tests, privacy row): the repeated recipes written once.
- [ ] Issue templates on GitHub (bug with diagnostics, feature idea) and a public roadmap page on the website from
      this plan.

## Optimisation (how it runs)

- [x] Measure first: RAM (app + WebView2), cold start to first paint, idle CPU while playing and in the tray, on a
      10 000-song library. A `pnpm bench` script and numbers in `docs/`; the website quotes them. Done 2026-10-30
      (`pnpm bench`, `docs/performance.md`); left: the website quoting the numbers, YouTube not measured.
- [ ] Performance budget in CI: front-end bundle size and Rust startup time; fail on a large regression.
- [x] Bundle: Home, Search, Add, Mixes, Stats, Smart, editor panel, Welcome and the YouTube shelves are lazy (Theme Studio, Sync
      Mode and Plugins live in Settings / Add-ons, already lazy); icons were already imported one by one (Phosphor).
      First-load JS 948 to 829 kB (gzip 279 to 255). Left: LyricsPanel, dialogs, NowPlaying are still in the first chunk.
      Review fixes (2026-10-31): a failed chunk is caught by `PageBoundary` (retry), the deferred starts are independent,
      cover temp files are unique per write, the Legal wording is true, Deezer links route by host, link requests time out
      (20 s) and Apple's page is capped (8 MB). The 3000-song YouTube matching reports progress ("120 of 300") and has a Cancel
      (2026-10-31, `docs/playback.md`).
- [ ] Re-renders: profile the player bar, Up next and lyrics at 60 fps (`Progress.tsx`); Zustand selectors everywhere.
- [ ] Library at scale: 50 000 songs, check every query with `EXPLAIN QUERY PLAN` (indexes for artist, album,
      plays, likes), search with FTS5, scans in the background with progress.
- [x] Cover cache: size cap with least-recently-used eviction, thumbnails at the sizes we show (no full images in lists). (done 2026-10-31: cap 500 MB, a setting; `?s=64/256/600`; `crates/core/src/artcache.rs`)
- [ ] YouTube embeds: one player reused instead of one per song where the crossfade allows; unload the hidden one.
- [ ] Tray mode: measure what's left (WebView2 suspended?), drop it further if the page can be unloaded and restored.
- [x] Startup: plugins, the update and Sync Mode rounds, Discord, Last.fm start after the UI's ready signal (or 8 s; the log says which,
      and the e2e walk fails on the timer). Left, on purpose:
      the shield's lists load early (first YouTube request), the library opens in setup (the window's colour needs its settings).
- [ ] Installer size: check what's in it (`cargo bloat`, features of big crates, adblock lists compressed).

## Check live in the real app (built and unit-tested, never driven for real)

- [ ] Add to a YouTube Music playlist from an album page (cause of `STATUS_FAILED` assumed = duplicates); toasts + Undo
      / Add anyway; advanced fade by ear (curves, fade on skip, fade on pause); Home's YouTube Music shelves on a real
      account (unofficial API); Home items not in the library; new mixes after real listening; exact restore after an
      update.
- [ ] Tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user owns, blocked video falling
      back, Auto on a real music video, resume after a real restart, sort Most played.
- [ ] Repeat one / repeat all at a track's end, menu actions that write (rename, delete, export, remove from playlist),
      local file covers, Apple cover backfill, Spotify covers, add another Google account, sign out.
- [ ] Landed the night of 2026-10-31, never seen on a real screen: Deezer and Apple links through the paste box, Shift + wheel
      on a real mouse and the volume number, SponsorBlock turned on (a real intro skipped, Undo, marks on the progress bar), Skip
      silence across real crossfades, Karaoke on plain lyrics, with animations off and over a video in the watch page, a
      10 000-song scroll asking only 64 px covers.

- [ ] `pnpm bench` on a quiet PC: the full run on af27405 was disturbed (someone back at the PC: load 78 %, restart 1.91 s,
      tray 135 MB, the page awake again after its suspend), row not kept. The website's numbers come from d853980: confirm the
      54 MB in the tray after Visualizer v2, or find what wakes the page and fix the numbers.

## Not done yet

- [ ] Media panel off Windows.
- [ ] Spotify previews.
- [ ] Mixes: genre / year tags (not stored yet), Last.fm "Discoveries" (user's key); "Never in mixes" on a discovered
      song (not in the library: no row to hold the choice).
- [ ] Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
- [ ] Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
      clicked in a browser (deep-link registration).
- [ ] Bonus list (pick): equalizer (local files).

**Spotify** (no keys; the user chose link import)
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: private playlists and Liked Songs (web session), ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- [ ] Local only: `ui/dev/` preview harness (excluded in `.git/info/exclude`), delete when no longer useful.
- Dependabot alert #1 (`glib` 0.18, Linux only, through Tauri's GTK3 stack) dismissed: re-check at each Tauri upgrade.

## Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
- No circumventing Premium or DRM. Quotas respected, no server of ours.
