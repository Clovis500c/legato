# Legato: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign, the product pass, roadmap milestones 0 to 2, the user's choices along the
way) is in git: `git log -p docs/notes/plan-v2.md`, and in the release notes.

Stable: v1.1.479 (2026-10-31). Next: milestone 3, Lyrics.

Every idea here stays: the user wants them all built in the end, just later (user's choice 2026-10-31). The roadmap sets
the order; a line leaves only when it ships or the user drops it.

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
Milestones 0 (Groundwork), 1 (First impression) and 2 (Sound and sight) shipped together as Stable 1.1, so the version
numbers below moved up by one.

| # | Milestone | What lands | Effort | Why now |
|---|---|---|---|---|
| 3 | Lyrics (1.2) | Word-by-word lyrics, translation, find by a line, lyrics saved into files and tapped live | M | Riff and Cider's most loved screen |
| 4 | Your own music (1.3) | Jellyfin / Navidrome / Subsonic, ReplayGain, batch tag editor + MusicBrainz, ratings, column view, ListenBrainz, playlist folders | L | MusicBee / foobar / Plexamp users switch for this |
| 5 | Smart (1.4) | Local sonic analysis, song / artist radio, sweet fades, path between artists, auto-DJ, smart shuffle, Wrapped | L | What no free desktop app does without a server |
| 6 | Around the house (1.5) | Phone remote, cast (DLNA / Chromecast), listen together on the LAN, pick up on the other PC | L | Turns a player into a home system |
| 7 | Windows polish (1.6) | Command palette, taskbar buttons + Jump List, headphones / call pause, alarm, OBS overlay, PiP, drag from Explorer | M | Small, many, each a reason to stay |
| 8 | Everywhere (2.0) | macOS and Linux builds, Android companion | L | Riff's one platform lead |

Kept apart (need the user's call or an outside step): Spotify playback paths, LLM playlists with a user key, SoundCloud
playback (its terms), concerts (an API's terms), trademark search.

**1. Catch up with Riff (what a Riff user would miss)**
- [ ] Paste a SoundCloud link: imported; plays in SoundCloud's official embedded widget (no audio taken).
- [ ] SoundCloud search beside YouTube's (widget playback, its terms checked first).
- [ ] Lyrics translation in the panel (a service sends text: add the website's privacy row first).
- [ ] Cover colours beyond the surfaces: "Whole app in the cover's color" (`appTint`, `ambient.ts`) tints the surfaces with
      one average colour; a small palette for the accent and the selection is left (Theme Studio choice).
- [ ] Squiggly / waveform progress bar as a progress style choice.

**2. Beat Riff (things it can't or won't do)**
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
- [ ] Drag files or folders from Explorer onto the window: added (or played with Shift). Today dropped audio files play
      as a queue (`PlayerBar.tsx`), nothing is added and folders do nothing.
- [ ] Find a song by a line of its lyrics (LRCLIB search), and hum to search if AudD's free tier allows it.
- [ ] Credits and artist pages: who wrote / produced (MusicBrainz), a short bio (Wikipedia), links out.
- [ ] Playlist folders, pinned playlists, generated playlist covers (a 2×2 of the songs' covers).
- [ ] Same loudness across sources: YouTube vs local vs Spotify levelled by the Adaptive Sound meter.
- [ ] Backup / restore the whole library to one file (playlists, likes, edits, stats), outside Sync Mode.
- [ ] Hide explicit songs (a filter, YouTube Music's flag when there is one).

## Visualizer v2 (user's ask 2026-10-30: more realistic, more detailed)

First cut on Stable since 1.1 (`docs/playback.md`): 1/6-octave bands at 60 Hz from both twins, one canvas in a worker
drawn at 30 fps, eight looks (LED, Bars, Mirror, Peaks, Wave, Radial, VU needles, Spectrogram), the strip under the cover
and full screen on V. The lines left are in no milestone yet.

**Data (both twins alike: `crates/dsp` and `live.js`)**
- [ ] 1/3 and 1/12 octave bands (31 and 120, ANSI centers) beside today's 1/6 (61 bands).
- [ ] Weighting (A or ITU-R 468) and a +3 dB/octave tilt option, so music looks level instead of bass-heavy.
- [ ] Time-domain blocks in the frames (L/R, 1024 samples, as i16) for scope and vectorscope. Left / right bands, rms and
      peak are in.
- [ ] Beat and onset detection (spectral flux on low and mid bands, tempo estimate): kicks drive pulses, flashes, camera.
      The radial ring's pulse is Moving cover's own until then.
- [ ] Loudness stream (momentary / short-term LUFS, true peak) already measured by Adaptive Sound: exposed for meters.
- [ ] Unit tests: a sine lights its 1/12-octave band, a pink noise reads flat with the tilt, a click track gives its BPM.
      (The 1/6-octave sine, left-only, the twins' shared fixture and the 10 Hz strobe are in.)

**Renderer**
- [ ] Sizes left: a big backdrop behind Now Playing, the mini player, the OBS overlay page. A click on the visualizer
      could cycle its look (today right-click picks it, a click does nothing).
- [ ] Colours from the theme or the cover (`coverTint.ts`): gradient along frequency, by level, or the cover's palette.
      (Today the theme's text colour as read where it is drawn, so Now Playing's cover tint applies; no colour choices.)

**Styles (each with a few settings: bands, smoothing, peak hold, colours, mirror, reflection)**
- [ ] Spectrum bars, realistic: 1/3 and 1/12 octave, reflection on a glossy floor, frequency and dB scales on hover. (LED
      segments with held, falling caps are in, 1/6 octave.)
- [ ] Smooth spectrum curve (filled area, glow), stereo overlay (left and right in two colours).
- [ ] VU meters: the PPM option and other skins. (Two needles with VU ballistics, the peak LED, the theme's ink are in.)
- [ ] Loudness meter: LUFS bars (momentary, short-term, integrated), true peak, dynamic range of the song.
- [ ] Oscilloscope: the waveform, triggered on zero crossings so it stands still, phosphor afterglow.
- [ ] Vectorscope / goniometer (left vs right, Lissajous) with a correlation meter: stereo width at a glance.
- [ ] Spectrogram colour maps as an opt-in (magma, viridis; today the theme's ink with opacity), WebGL.
- [ ] Spectrum 3D: a terrain of the last seconds flying towards the camera (WebGL).
- [ ] Particles on the beat (from the cover's colours), with the cover's blur behind (Plexamp-like backdrop).
- [ ] Song waveform on the progress bar for local files (computed once from the file, cached; not for streams).
- [ ] Preset engine, written from scratch: equations per frame / per vertex driven by bands and beat (MilkDrop-style
      ideas), presets as small JSON shared like themes; `.milk` files the user owns loaded if a reader stays simple.
- [ ] Visualizer API for plugins (`crates/plugins`): a plugin gets bands, beat and loudness, draws with a restricted
      2D canvas command list (no raw access).

## Ideas loved in independent players (checked against our rules)

- [ ] Volume: a perceptual (dB) curve (it would make every saved volume louder or quieter; local and YouTube stay level
      because both are linear), and per-source volume memory (needs its own setting and a switch rule).
- [ ] Word-by-word lyrics when the source has them (enhanced LRC), background vocals apart, Apple-style animated lines
      (Cider, Spicetify's Beautiful Lyrics).
- [ ] Sweet fades (Plexamp): crossfade length picked per pair from the songs' ends (loudness, silence, tempo).
- [ ] A path between two artists (Plexamp's "Sonic Adventure"): a mix that walks from one to the other.
- [ ] Guest DJ-style picks between songs ("because you liked …"), local and explainable, no cloud.
- [ ] Auto-DJ that keeps the queue going from the library with rules (MusicBee).
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

Today: every green push to master is a Beta prerelease (479 commits so far, check 5-11 min then release 10-16 min) and
Stable goes out by hand (`promote`); the smoke test runs on every push; `src-tauri/src/lib.rs` 2149 lines; CLAUDE.md
~15 kB read by every session.

- [ ] Release notes grouped (feat / fix), in the user's words, shown in the app after an update. Today a flat list of
      commit subjects (`scripts/release.mjs`) on the update card.
- [ ] Typed `invoke` wrappers: the types are generated, the wrappers in `api.ts` stay by hand (no `tauri-specta`), so a
      command's name and arguments are still checked by eye.
- [ ] Split `src-tauri/src/lib.rs` by feature (library, player, accounts, sources) like `detector.rs` / `editor.rs`;
      same for `crates/core/src/library.rs` (queries per table).
- [ ] Make the smoke test blocking: delete `continue-on-error` in `check.yml` (green on the last 6 checks, 2026-10-31).
      Still outside it: the YouTube embed (needs the network) and a real audio device.
- [ ] The "Check live in the real app" list as a scripted checklist (a dev-only page that drives each step and logs the
      result), so a pass takes minutes, not a session.
- [ ] Diagnostics: a crash that ends the process without a Rust panic (a native fault, a kill) leaves no line; Windows'
      event log and minidumps are not read.
- [ ] Faster CI: run the macOS job only on pushes that touch Rust or `src-tauri`, `cargo nextest`, `sccache`; Linux
      job stays crates only.
- [ ] `graphify hook install` (the user's go) so the graph stays fresh without asking; then drop the `.gitattributes`
      line it adds (the graph isn't tracked).
- [ ] Trim CLAUDE.md to rules + pointers (structure details move to `docs/architecture.md`): cheaper sessions.
- [ ] Project skills for Claude Code: "release check", "add a setting" (schema, DEFAULTS_VERSION, search index, i18n),
      "add a connector" (module, mockito tests, privacy row): the repeated recipes written once.
- [ ] Issue templates on GitHub (bug with diagnostics, feature idea) and a public roadmap page on the website from
      this plan.

## Optimisation (how it runs)

- [ ] Performance budget in CI: front-end bundle size and Rust startup time; fail on a large regression. (`pnpm bench`
      isn't in CI yet.)
- [ ] Bundle: LyricsPanel, dialogs and NowPlaying are still in the first chunk.
- [ ] Re-renders: profile the player bar, Up next and lyrics at 60 fps (`Progress.tsx`); Zustand selectors everywhere.
- [ ] Library at scale: 50 000 songs, check every query with `EXPLAIN QUERY PLAN` (indexes for artist, album,
      plays, likes), search with FTS5, scans in the background with progress.
- [ ] Cover thumbnails for WebP and GIF originals, served whole today (the `image` crate here has PNG and JPEG only; the
      hosts send JPEG).
- [ ] YouTube embeds: one player reused instead of one per song where the crossfade allows; unload the hidden one.
- [ ] Tray mode: measure what's left (WebView2 suspended?), drop it further if the page can be unloaded and restored.
- [ ] Installer size: check what's in it (`cargo bloat`, features of big crates, adblock lists compressed).

## Check live in the real app (built and unit-tested, never driven for real)

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
- [ ] `pnpm bench` on a quiet PC: the full run on af27405 was disturbed (someone back at the PC: load 78 %, restart 1.91 s,
      tray 135 MB, the page awake again after its suspend), row not kept. The website's numbers come from d853980: confirm the
      54 MB in the tray after Visualizer v2, or find what wakes the page and fix the numbers.

## Waiting on the user (outside the code)

- [ ] Discord shows "Listening to Music App": that's the name of the app on Discord's developer portal (rename it there).
- [ ] Trademark search for Legato (INPI, EUIPO, USPTO classes 9, 41, 42).
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).
- [ ] SponsorBlock stays off by default (a new third party gets a hash prefix per video, the user opts in): flip the
      default if wanted.

## Not done yet

- [ ] Media panel off Windows.
- [ ] Spotify previews.
- [ ] Mixes: genre / year tags (not stored yet), Last.fm "Discoveries" (user's key); "Never in mixes" on a discovered
      song (not in the library: no row to hold the choice).
- [ ] Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
- [ ] Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
      clicked in a browser (deep-link registration).

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
