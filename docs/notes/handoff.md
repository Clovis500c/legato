# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-14 (window 13 closed).

## Where things stand
- **master** = `22cc704d`, pushed on the owner's word; **platforms** = master (`git log --oneline origin/master..HEAD` is
  empty): the Lot 39 skip signals, the Lot 40-41 banner work, the Lot 42 recommendation (`2c006e25` design, `dacf3cd6`,
  `a137385c`, `01475207`, `ca2f6720`, `74501e5d`, `7b6f2053`, `14e7b87d`, `66b542e8`, review fix `2f781c23`) and this
  handoff are all on it. The push starts a Beta release (1.2.22 by `release.mjs --dry-run` at `22cc704d`): it may still be
  running, not confirmed published here. Only the owner's word pushes.
- **Stable 1.2.10** (tag `v1.2.10`, since 2026-11-14, promoted on the owner's word): Windows installer, `latest.json`, the
  Android APK. winget has an older Stable pending (see below).
- **Version rule** (`CONTRIBUTING.md` › Version): `MAJOR.MINOR` is in `src-tauri/tauri.conf.json` (`1.2`). The patch is n,
  the number of commits since the base of that `MAJOR.MINOR` (`BASES` in `scripts/release.mjs`: `'1.2'` → `f8379a93`), with
  `n % 1000`. The patch is n, not a counter of your own. `node scripts/release.mjs --dry-run` prints the next Beta pushed
  from here (v1.2.22 at `22cc704d`). A bump of `MAJOR.MINOR` is the owner's decision: a new base goes in
  `BASES` first.
- **Before any push**: `pnpm check` green; `node scripts/budget.mjs` (JS 332 of 340 kB gzip: little room, lazy-load new
  features); `cargo clippy --workspace --all-targets -- -D warnings`; `pnpm build` in `site/`; a clean tree; **`pnpm e2e`
  when the push touches startup** (`setup` in `src-tauri/src/lib.rs`, anything that reads `AppState`); and
  `git log --name-only --format= origin/master..HEAD | grep -i notes/report` must print nothing. A push to master is a
  Beta release.
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **Reports** (`docs/notes/report*.md`, the owner's French reports) are git-ignored and never committed.
- **The rename is done** (Music App → Legato in every format). The one catch-up for data on disk is
  `src-tauri/src/rename.rs` (plus the old Run entry in `autostart.rs`, the old-install cleanup in
  `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename catch-up » lists what to delete.
- **Android**: the release job compiles the whole crate; anything desktop-only sits behind `#[cfg(desktop)]` or
  `#[cfg(windows)]`. The Android target and the Kotlin toolchain are not usable on this PC: CI's android job is the check.
  The widgets never ran on a phone.
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, not yet Arabic or Hebrew.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681) waits for a moderator; each new Stable needs a new manifest
  (`packaging/README.md`).
- **Never tried for real**: plan-v2 › Check live in the real app. Most features of the last windows were never run on a
  screen, an ear, a real feed, a TV, a pad, a phone, a speaker, a webcam, a Stream Deck, a Subsonic server, or with the real
  translation, YouTube or AcoustID services.
- **Untracked, never committed**: `docs/notes/report*.md`, the old transcript `2026-10-30-001238-…txt` at the root.

## The algorithm
`docs/recommendation.md` is where it lives: the design, the weights (all first guesses, never heard by ear), the measured
numbers. In short: `taste_signals` (Rust, one pass) → `player/taste.ts` (store) → `player/score.ts` (pure: profiles,
z-scores, explore dose by Variety, diversity re-rank) used by Shuffle (`shuffle.ts`, weighted order), the end of Up next
(`radio.ts`, `autoplay.ts`) and « Start a mix from this song » (`songMix.ts`, a chunk loaded at the click); the Mixes page's
« Like <title> » mixes are built in Rust (`mixes()`). Variety (Alike / Balanced / Adventurous) is the one control.

## Try first (the owner)
Most of what is new is behind a setting that is **off**, unless noted below.
- **Shuffle**: your loved and often played songs come sooner, nothing is ever out, never the same artist twice in a row.
  Judge Alike (sticks to your favourites), Balanced, Adventurous by ear. **The end of Up next**: 15 songs added, a bounded
  dose of the new (10 / 20 / 35 %), at most 2 per artist in 10; there is no « Then, similar songs » switch any more.
- **« Start a mix from this song »** (right-click a song): 30 songs of its style, the song first, tempo within 12 bpm a step,
  a favourite every third. **The Mixes page**: « Made from songs you love », « Like <title> » (the seed turns daily).
  Songs without genre or year make a looser « style ». **Variety**: Settings › Playback and the Up next panel.
- **Playlist banners** (always on): the wall of the playlist's covers, real variety, four corners covered, a soft fade on
  the right (no blur: removed at the owner's word). The Home carousel « Your playlists » is on by default.
- **Settings reorganised** (Features, Devices, Library and storage; « Advanced » at the bottom); **right-click menus** (three
  levels, « Personalise the menus »); **themes** (eight presets); **similar songs weigh skips and Never**.
- **Free song recognition** (SMTC, Chromaprint + AcoustID: the AcoustID key still has to be registered); **YouTube chapters**;
  **sweet fades**; **lyrics translation** (asks each time); **guessed key**; **cast to a speaker or TV** (DLNA); **equalizer
  and volume per output device**; **Stream Deck**; **webcam QR scan**; **Subsonic playlists**; **living-room mode**,
  **podcasts**, **audiobooks**, **practice speed**, **Discord sign-in**, **Android widgets**.
- **Right to left** (Arabic, Hebrew): never looked at on a screen; machine translations to review. Every new text of lots
  39-42 is a machine translation too (the French one says `vous`).
- **Frozen or blurred window** (the owner's other PC, Beta 1.1.973): if it comes back, look for a `webview` line in the
  diagnostics log. Cause not proven. **Diagnostics**: Settings › About › Copy diagnostics says « the last run ended without
  closing » after a kill.

## Open
- **For Opus**: a Subsonic playlist half-made if adding its tail fails after creation; the cast server stays open after the
  song ends (the token protects it); a public podcast name that resolves to a private address (DNS rebinding) still passes;
  the gamepad is polled every frame in living-room mode even with no pad; the Stream Deck inspector accepts more addresses
  than the plugin; the e2e failed once at the home screen (a dialog left open), not reproduced; one `cargo test` of the
  legato crate froze 6 minutes once (while a dev app ran), not reproduced: watch CI; the Android target was never compiled
  here.
- **Left, for a run that can check it**: MPRIS and macOS Now Playing (CI skips the legato crate there); WASAPI exclusive;
  « Up next » per chapter; the website in Arabic and Hebrew; plural forms beyond one / other in ar and he; faster CI; reused
  YouTube embeds; the full `pnpm bench` (it now prints a « shuffle 10000 » line; the rest was not run for lot 42).
- **For the owner**: the algorithm's weights by ear; a YouTube channel identifier stored with each song; preloading the next
  song's artist (a privacy decision); Last.fm / ListenBrainz as a source; the site redesign's taste; the theme and plugin
  gallery; profiles on a PC; the Discord bot and its signature; the Arabic and Hebrew review; the lines that need an account
  or a real network (Spotify and SoundCloud sends, concerts, TIDAL / Qobuz links, watch-page autoplay).

## Next
The remaining plan lines need a real account or network, an owner's choice, a Linux or macOS machine, or a device. A later
run takes what needs nobody, one line at a time, in plan-v2's order. One step = `graphify query` first, code and tests,
`pnpm check` green, one local commit on `platforms`, its plan-v2 line ticked with what wasn't tried for real,
`graphify update .`.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
`gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
`releases/latest/download/latest.json` after.

## Reprendre l'orchestration
For a new orchestrating session with an empty context:
1. Read `CLAUDE.md`, this handoff, then only the useful parts of `docs/notes/plan-v2.md`. The owner's private notes
   (`docs/notes/report-asks.md`, `report-2026-11-12.md`, `report-orchestrator-prompt.md`) are untracked: read them for what
   was asked and decided, never copy them into tracked files.
2. **Sessions**: one per model, reused (send a message) rather than restarted: one Sonnet (builds, `claude-sonnet-5-5`), one
   Opus (reviews and designs, `claude-opus-5-5`; `start_session` ignores a model dearer than the orchestrator's), one Haiku
   (docs, handoff, reports, checks). The builder works in small slices, the reviewer rereads each batch and does the
   delicate parts (startup, security, the release).
3. One writer at a time on the checkout. Stage by name (`git add <file>`), never `git add -A` or `.`. Commit only what the
   task names. No push without the owner's word.
4. **Heavy checks** (`pnpm check`, `cargo clippy`, `cargo test`, `pnpm vite build`, `pnpm build`, `pnpm e2e`): in the
   foreground with a 10-minute timeout, with `CARGO_BUILD_JOBS=6` and below-normal priority (PowerShell:
   `$env:CARGO_BUILD_JOBS='6'; $p = Start-Process -FilePath pnpm.cmd -ArgumentList 'check' -NoNewWindow -PassThru;
   $p.PriorityClass = 'BelowNormal'; $p.WaitForExit()`), so the owner's PC and his apps stay responsive. A `pnpm check` run
   in the background ends a worker's turn early and stalls the chain.
5. End markers go in `docs/notes/report-inbox.md` (`Clôture N finie : <hash>`); the orchestrator merges them into the private
   report and empties the inbox. The weekly usage cap is 75 %: plan the work to fit under it.

## Two PCs
The owner works on two Windows PCs, each with `C:\dev\music-app`, kept alike through GitHub. The first holds the signing keys
and the Android tools (`C:\dev\android`). Each PC's own setup is in Claude Code's private memory on that PC, not in the repo.

## Traps not written elsewhere
- `app.state()` before `app.manage()` panics at launch (`36785ec2`, fixed in `468c51ab`): only the CI's e2e caught it.
- Tauri 2.12's `focused`, `focusable` and `skip_taskbar` exist only on desktop: keep them behind `#[cfg(desktop)]`.
- macOS has only 127.0.0.1 on its loopback: a test that binds 127.0.0.2 must skip there.
- Node 22's `node --test` wants its glob in quotes.
- Settings labels: an `id` is never changed (it is the `data-setting`, the locale key while there is no label, and the search
  key); a renamed setting's spoken name goes through `labelOf`, not `tr('<id>')`.
- **CRLF / LF**: a PC whose working copy is CRLF fails `no_sync_command_locks_the_library` (it wants LF). Convert
  `src-tauri/src/*.rs` to LF locally; git sees no real change, so an empty-diff `M src-tauri/src/servers.rs` in
  `git status` is that artefact: never commit it.
- The bench's cold start is noisy: run `pnpm bench --quick --skip-build` twice more before believing a regression.
- `scripts/promote.mjs --dry-run` needs the release tags locally: `git fetch --tags` first.
- `git worktree remove` can stop at "Filename too long": `cmd /c rd /s /q "\?\<full path>"`; a Bash `cd` into a worktree
  moves the session's working folder.
- Android builds rewrite `src-tauri/gen/android/app/tauri.properties`: restore it after. PowerShell 5.1 mangles inline JSON:
  give `--config` a file. The page's `fetch` to the `art` scheme fails on Android (CSP): covers go through an `<img>` and a
  canvas (`phoneCover`). `MainActivity.kt` empties wry's `mWebView` field so YouTube is not paused behind other apps.
- Headless emulator: `emulator -avd legato36 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim`; stop
  it after a test. Never answer Windows' firewall or any system prompt.
- `pnpm notices` (cargo-about) once on a new PC: a release build stops without `src-tauri/third-party-licenses.html`.
- Google limits an address after about 40 anonymous searches: expect it in any search test, never route around it.
- The website: `app/[lang]`'s static export needs one language besides English in `COPIES`; `npx tsc -p site` shows stale
  `.next/types` errors until `npx next build` rewrites them.
- Claude desktop's tools run inside an MSIX package and see a stale copy of `%APPDATA%` (`docs/development.md` › Two dev
  libraries).
- Ad-hoc Python edits of CRLF files through `open()` keep CRLF on Windows; a `\n` typed inside a non-raw string in a script
  that writes JS or TS becomes a real newline: write those with the edit tool.

## History
The 0.1 releases, 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13), 1.1 and the v2 plan (Stable
1.1.479, 2026-10-31); then imports, lyrics, the phone, device sync, the visualizer's v2, listening rooms, personal servers,
the website in 18 languages; Stable 1.1.681 (2026-11-05), Betas up to 1.1.994, Beta 1.2.1 (the first on the 1.2 line),
Beta and Stable 1.2.10 (2026-11-14, `1215f5b4`). Since 1.1.932: podcasts, the output device, living-room mode, audiobooks,
Discord sign-in, YouTube chapters, sweet fades, lyrics translation, DLNA cast, right-to-left, the Stream Deck plugin, the
settings reorganisation, right-click levels, themes, playlist banners, free song recognition, and the recommendation
algorithm (on master since `22cc704d`). Reviews 23 to 25 were run by Sonnet in the Opus session; that session was switched
to Opus 5.5 only afterwards. The rest: `git log`, the release notes.
