# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-14 (window 10 closed).

## Where things stand
- **master** = `611dc3b0` = **Beta 1.1.994** (CI and APK green on that commit). **Stable** 1.1.681 (2026-11-05): Windows
  installer, `latest.json`, the Android APK.
- **platforms** = master + the local commits (74 at this commit, `git log origin/master..platforms --oneline | wc -l`,
  this handoff's commit included). Not pushed at the time of this handoff: the push of this batch follows, by the
  orchestrator (the owner allowed it). Check `git log origin/master..platforms` to see whether it has happened. Opus has
  reread everything, up to `5c1dd96b`.
- **The rename is done** (Beta 1.1.932): Music App → Legato in every format (QR prefix `LG1:`, `_legato._tcp`,
  `.legatosync`, `legato://` links). The one catch-up for data on disk is `src-tauri/src/rename.rs` (plus the old Run
  entry in `autostart.rs`, the old-install cleanup in `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename
  catch-up » lists what to delete, once every PC of the owner has the new name.
- **Cost, accepted**: old share links and QR codes stop working; a PC on an older version is invisible on the local
  network and in the sync folder until it's updated.
- **Push rule**: before any push, run `pnpm check`, `node scripts/budget.mjs` (JS budget: 328 of 340 kB gzip),
  `cargo clippy --workspace --all-targets -- -D warnings` (the CI's clippy is newer than the local one), `pnpm build`
  in `site/`, and **`pnpm e2e` locally when the push touches startup** (`setup` in `src-tauri/src/lib.rs`, anything
  that reads `AppState`): 36785ec2 panicked every launch (`state()` before `manage()`), and only the CI's e2e caught it
  (fixed in `468c51ab`). Then `git log --name-only --format= origin/master..HEAD | grep -i notes/report` must print
  nothing: no report in a commit, ever. A push to master is a Beta release.
- **Reports** (`docs/notes/report*.md`, the owner's French reports) are git-ignored and never committed. The history was
  purged of them before the push of window 10 (`filter-branch`, 31 commits rewritten, nothing before `611dc3b0`).
- **Android**: the release job compiles the whole crate: anything desktop-only sits behind `#[cfg(desktop)]` or
  `#[cfg(windows)]`. `aarch64-linux-android` is not installed here and the Kotlin is never built on this PC: the CI's
  android job is the check. Build the APK on the Gradle PC before trusting the widgets.
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681): waiting for a moderator. Each new Stable needs a new
  manifest (`packaging/README.md`).
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, the Discord invitation included.
  A first pass of the redesign and a Docs page are in; not yet in Arabic or Hebrew (the app is).
- **Discord sign-in** (`75b90e76`): the portal side is set by the owner per the orchestrator (redirect
  `http://127.0.0.1:47819/callback`, « Client public » on, application « Legato Manager ») and not re-checked here. The
  public ID is in the code. The bot is a plan line for later. The profile card is in Accounts.
- **Never tried for real**: plan-v2 › Check live in the real app. The owner's finds there come first. The features of
  the last windows were never run on a screen, an ear, a real feed, a TV, a pad, a phone, a speaker, a webcam, a Stream
  Deck, a Subsonic server, or with the real translation, YouTube or AcoustID services.
- **Untracked, never committed**: `docs/notes/report*.md` and `docs/notes/report-inbox.md` (the owner's reports, in
  French) and the old transcript `2026-10-30-001238-…txt` at the root.

## Try first (the owner)
Everything new is behind a setting that is **off** by default, unless noted. Nothing changes for someone who switches
nothing on.
- **Settings reorganised**: new pages Features, Devices, Library and storage; « Advanced » folded at the bottom of each
  page; shorter labels; the search finds the old names too.
- **Right-click menus**: three levels, Essentials / Standard / Full detail, and « Personalise the menus » (Appearance ›
  Right-click). Standard is the default, and loses nothing.
- **Themes**: eight presets with a live preview; « Duplicate to edit » copies a preset; the editor sits under Advanced.
- **Playlist banners** (Steam-like): a carousel on Home and a band over a playlist's page.
- **Free song recognition**: Windows' media panel (SMTC) and Chromaprint + AcoustID. AcoustID needs its application key
  registered on acoustid.org; until then the detector says so and asks for nothing.
- **Similar songs** (Proches / Balanced / Adventurous): the queue's taste profile, and « Next » fixed on the last song.
- **Wrong artist** fixed: an artist's page is kept only when one of its songs is one the app knows of that artist.
- **YouTube chapters** of a long video (player menu).
- **Sweet fades** (tempo, loudness, silence): a fade between two songs.
- **Lyrics translation** (MyMemory): asks each time in a box; the words of one song are sent only after your yes.
- **Guessed key**: an empty key is filled from the sound, with the tempo scan.
- **Cast to a speaker or TV** (DLNA / UPnP): a local song served by a one-file private server, kept open until Stop, a
  new cast, or quit. Test it on a real renderer.
- **Equalizer preset per output device**; **volume per output device**; the **output device** (player menu, with 2+ devices).
- **Right to left** (Arabic, Hebrew): never looked at on a screen; the translations are machine translations, to be
  reviewed by native speakers.
- **Stream Deck** plugin (`integrations/streamdeck`, see `docs/streamdeck.md`): play / pause, next, previous, now playing.
- **Webcam QR scan** (Settings › Playback): adding a device, sharing a playlist, listening rooms.
- **Subsonic**: send a playlist to your server (menu « Send to <server> »); asks first.
- **Artist photos**: a default with initials until the photo arrives.
- **Living-room mode**, **Podcasts** (and the 6 h check), **Audiobooks**, **practice speed**, **estimate tempo**,
  **Discord sign-in**, **Android widgets** (rectangle, disc, queue; never run yet): as in earlier windows.
- **Frozen or blurred window** (seen on the owner's other PC, Beta 1.1.973, after about 2 minutes, with the Windhawk mod
  `translucent-windows` 1.8.2): if it comes back, look for a `webview` line in the diagnostics log, and test by excluding
  `legato.exe` in translucent-windows. Cause not proven.
- **Diagnostics**: kill the app in Task Manager, start it again, then Settings › About › Copy diagnostics has « the last
  run ended without closing ».
- **Covers and theme backgrounds** still show everywhere (the `art` scheme answers our own window only, `9868235b`).

Older tries (Beta 1.1.932), still open:
- Sync between the two PCs after the rename: a sync folder « Music App Sync » becomes « Legato Sync »; each PC finds the other.
- A new share link and QR code (`LG1:`), read back on the other PC.
- Icons in the built app (`d0db29ff`; `pnpm dev` doesn't show the release build's problem).
- Audiobook chapters (a real `.m4b` from Audible or iTunes; an mp3 book) and sleep at the end of a chapter.
- YouTube search while signed out: a song is found and plays.

## Open
- **For Opus**: the security pass is done (`9f845dcb`), and so are the lib.rs and library.rs splits. Known leftovers in
  the reports: a Subsonic playlist half-made if adding its tail fails after creation (a new send makes a second one);
  the cast server stays open after the song ends (the token protects it); a public podcast name that resolves to a
  private address (DNS rebinding) still passes; the gamepad is polled every frame with living-room mode on, even with
  no pad; `artistOf` is recomputed per candidate in the similar-songs ranking (not measured); the Stream Deck inspector
  accepts more addresses than the plugin; the e2e failed once at the home screen (a dialog left open) and was not
  reproduced in three runs: `5c1dd96b` names the dialog next time. The Android target was never compiled here.
- **Left, for a run that can check it**: MPRIS and macOS Now Playing (CI skips the legato crate on ubuntu and macos, so
  nothing could check it here); WASAPI exclusive (cpal has none: an own COM renderer, needs the device); « Up next » per
  chapter (a change to the player and the queue, needs a start offset); the website in Arabic and Hebrew; plural forms
  beyond one / other in ar and he; the skip signals as negative weights in similar songs (a Rust command, types and two
  tests: written in plan-v2); faster CI (test on a branch); reused YouTube embeds.
- **For the owner**: the Discord bot and its signature; the theme and plugin gallery (there is no index repository yet);
  profiles on a PC (the launch path comes first); the identifier of a song's YouTube channel (stored with the song, a
  library column and a migration, or one request more per song); preloading the next song's artist (a request more to
  YouTube per song: a privacy decision); Last.fm / ListenBrainz as a source for similar songs; the Arabic and Hebrew
  translations (native review); the site redesign's taste (the chapters under the hero, the Features block); the
  photos of the big title (which side); the lines that need an account or a real network (Spotify and SoundCloud sends,
  concerts, TIDAL / Qobuz links, watch-page autoplay).

## Next
The sweep at the end of Lot 20 in `docs/notes/report-2026-11-12.md` says what blocks each line. The remaining lines
need a real account or network, an owner's choice, a Linux or macOS machine, or a device. A later run takes what needs
nobody, one line at a time, from plan-v2's order.

**For Opus**: see Open above.
**For the owner**: their tries above; the AcoustID key; the Discord bot's signature; the galerie, profiles and
identifier decisions; the Arabic and Hebrew review; the photos side; the QR-scan crash on Android (Copy diagnostics from
Beta 1.1.801); Spotify and SoundCloud (accounts, terms); the `.lmix` that carries local audio (export warning, personal
servers).

One step = `graphify query` first, code and tests, `pnpm check` green, one local commit on `platforms`, its plan-v2
line ticked with what wasn't tried for real, `graphify update .`.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: only on the owner's word; `git fetch --tags`, `node scripts/promote.mjs
--dry-run <version>`, then `gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`;
check `releases/latest/download/latest.json` after.

## Waiting on the owner
- Their tries of the Betas (plan-v2 › Check live, the last items first). On the phone, background play behind other
  apps, the notification's controls and the phone ↔ PC sync were only tried on the emulator.
- A backup of the signing keys (GitHub's secrets can't be read back: `CONTRIBUTING.md` › Releasing).
- A Linux VM or WSL for local tries, set up by them (a system change).
- plan-v2 › Waiting on the user, › Not done yet.

## Two PCs
The owner works on two Windows PCs, each with `C:\dev\music-app`, kept alike through GitHub. The first holds the signing
keys and the Android tools (`C:\dev\android`): signed releases and APKs come from there or from GitHub's Actions. Each
PC's own setup is in Claude Code's private memory on that PC, not in the repo.

## Traps not written elsewhere
- The bench's cold start is noisy (1.44 s, then 0.76 and 0.73 s on the same code): run
  `pnpm bench --quick --skip-build` twice more before believing a regression.
- `scripts/promote.mjs --dry-run` needs the release tags locally: `git fetch --tags` first.
- `git worktree remove` can stop at "Filename too long" (node_modules, target): `cmd /c rd /s /q "\?\<full path>"`.
  A Bash `cd` into a worktree moves the session's working folder: `cd` back before removing it.
- Android builds rewrite `src-tauri/gen/android/app/tauri.properties`: restore it after. PowerShell 5.1 mangles inline
  JSON: give `--config` a file.
- Android's WebView: wry's `onPause` paused YouTube behind other apps, so `MainActivity.kt` empties wry's `mWebView`
  field (its comments say why). The page's `fetch` to the `art` scheme fails on Android (CSP): covers go through an
  `<img>` and a canvas (`phoneCover`).
- Tauri 2.12's `focused`, `focusable` and `skip_taskbar` exist only on desktop: a window option set in code shared with
  Android breaks the Android build (`611dc3b0`).
- No Gradle cache on this PC: the Kotlin can't be built here. Build the APK on the Gradle PC before trusting it.
- Headless emulator: `emulator -avd legato36 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim`;
  stop it after a test. Never answer Windows' firewall or any system prompt.
- `pnpm notices` (cargo-about) once on a new PC: a release build stops without `src-tauri/third-party-licenses.html`.
- Google limits an address after about 40 anonymous searches (a 5-minute block, then one every 15 s): expect it in any
  search test, never route around it.
- The website: `app/[lang]`'s static export needs one language besides English in `COPIES`; `npx tsc -p site` shows
  stale `.next/types` errors until `npx next build` rewrites them; its dev server can keep a stale error after routes
  move: restart it.
- Settings labels: an `id` is never changed (it is the `data-setting`, the locale key while there is no label, and the
  search key); a renamed setting's spoken name must go through `labelOf`, not `tr('<id>')` (`03b32513`).
- Claude desktop's tools run inside an MSIX package and see a stale copy of `%APPDATA%` (`docs/development.md` › Two
  dev libraries).

## History
The 0.1 releases, 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13 in every format), 1.1 and
the v2 plan (Stable 1.1.479, 2026-10-31); then imports, lyrics, the phone (Android from 2026-11-02, its updates in the
app), device sync, the visualizer's v2, listening rooms, personal servers, Against Liner, the website in 18 languages;
Stable 1.1.681 (2026-11-05), Betas up to 1.1.795 (2026-11-07), Beta 1.1.896 (2026-11-12), Beta 1.1.932 (2026-11-13),
Beta 1.1.973 (2026-11-13, the startup panic fix), Beta 1.1.994 (2026-11-13, `611dc3b0`). Since 1.1.932: podcasts by RSS,
the output device, practice speed, living-room mode, an audiobooks page, the podcast check, Discord sign-in, tempo
estimate, YouTube chapters, sweet fades, lyrics translation, DLNA cast, right-to-left, the Stream Deck plugin, webcam QR
scan, Subsonic playlists, the settings reorganisation, the right-click levels, themes, playlist banners, similar songs,
artist photos, the wrong-artist fix, free song recognition; each behind an off setting, unless noted above.
The rest: `git log`, the release notes.
