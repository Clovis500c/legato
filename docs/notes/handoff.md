# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-18 (evening, lots 59 to 65).

## Where things stand
- **master** = `fb5676fc`, Beta **1.2.41** (2026-11-15). Stable **1.2.10** (tag `v1.2.10`), unchanged.
- **platforms** = master + 52 local commits, **none pushed** (`git log --oneline origin/master..HEAD`, this handoff
  included). Only the owner's word pushes.
- **Next Beta**: `node scripts/release.mjs --dry-run` gives v1.2.93 (checked after this commit). The push of platforms
  releases it.
- **Never put `[skip release]` on the last commit of a push you want as a Beta**: `release.yml` reads the head commit's
  first line. This handoff commit must not carry it.
- **Version rule** (`CONTRIBUTING.md` › Version): `MAJOR.MINOR` is in `src-tauri/tauri.conf.json` (`1.2`); the patch is
  the number of commits since the base in `BASES` (`scripts/release.mjs`), with `n % 1000`. A bump of `MAJOR.MINOR` is
  the owner's decision.
- **Heavy commands** are allowed again, with limits. Only after a local check that the PC is free (a private script kept
  outside the repo; see the orchestrator's notes). Limits: 4 jobs (`CARGO_BUILD_JOBS=4`), 4 test threads, below-normal
  priority, one heavy command at a time, targeted first (`cargo test -p <crate> <filter>`, `vitest run <file>`). The full
  `pnpm check`, `pnpm e2e` and `pnpm build` only when a push needs them. GitHub's CI is the gate.
- **Before any push**: a clean tree; `git log --name-only --format= origin/master..HEAD | grep -i notes/report` must print
  nothing; `pnpm e2e` when the push touches startup (`setup` in `src-tauri/src/lib.rs`, anything that reads `AppState`).
  The first push also tests the macOS skip in `.github/workflows/check.yml` (a push that touches no Rust, shell or
  workflow file skips the macOS build). A push to master is a Beta release.
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **Reports** (`docs/notes/report*.md`) are git-ignored and never committed.
- **The rename is done.** The one catch-up for data on disk is `src-tauri/src/rename.rs` (plus the old Run entry in
  `autostart.rs` and the old-install cleanup in `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename
  catch-up » lists what to delete.
- **Android**: the release job compiles the whole crate; desktop-only code sits behind `#[cfg(desktop)]` or
  `#[cfg(windows)]`. The Android target and the Kotlin toolchain are not usable on this PC: CI's android job is the check.
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, not yet Arabic or Hebrew.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681) waits for a moderator; each new Stable needs a new manifest
  (`packaging/README.md`).
- **Discord pings** (`CONTRIBUTING.md` › Releasing, `.github/workflows/release.yml`): MonitoRSS reads the releases feed.
  A Beta's title is "Legato vX.Y.Z beta" and gets an embed with the Beta News Ping role; the promotion renames it to
  "Legato vX.Y.Z" in the same `gh release edit`, and the Updates Ping follows. Titles checked with `gh` on 1.2.40 and
  1.2.41; the Discord messages themselves not seen here. Betas before 2026-11-15 have no "beta" in their title and are
  not re-announced.

## The algorithm
`docs/recommendation.md` is where it lives: the design, the weights (first guesses, never heard by ear), the measured
numbers. Candidates: the library, plus the YouTube Music radios of the last songs (up to 3, merged; a song in several
radios gets a vote; signed in or out). The score ranks them: fit (similarity) × preference (likes, ratings, replays,
skips), then diversity. Shuffle weighs rest × marks and keeps each artist apart. An early skip of one of the app's own
picks sends the rest of its artist out of the next 10 (a second skip sends them to the end). Each pick at the end of Up
next or in a mix shows why (`pickWhy.ts`). `taste_signals` (Rust, one pass) counts replays within 24 h and drops a pair
skipped twice from the neighbours. Google's refusal pauses lists and radios for 15 minutes (`searchpace::Quiet`).

## Try first (the owner)
Only what is untried. Most of the rest is behind a setting that is **off** by default.
- **Lot 59, menus**: right-click the visualizer, in Essentials then Standard; right-click a catalog result in Add music.
- **Lot 60, TV home**: living-room mode on: the Up next row shows six tiles; press one to play it. With Spotify signed
  out, no unplayable tile.
- **Lot 61, lyrics translation**: on a song with lyrics, « Translate… » shows the lines under each sung line. Change the
  interface language: the translation stays with its song.
- **Lot 62, sidebar and video**: no mini player card under the sidebar. A YouTube video plays out of sight unless the mini
  player is on; Now Playing shows it. The end of Up next, signed out, fills with radios of the last three songs.
- **Lot 63, phone**: five bottom tabs at 375 px, Radio among them. Blind test: let a round time out (30 s): the song
  shows, 0 points.
- **Lot 64, reasons**: read the reason under each Up next title after a queue ends; skip quickly a pick of an artist that
  returns and watch the list reorder.
- **Lot 65, replays**: replay a song the same day; it should rise in Shuffle (not heard by ear).
- **Six review fixes**: with two PCs on this build, add a song to an imported playlist on one, sync, remove it on the
  other: it spreads. Paste two Discord links in a row: the first file stays.
- **Machine translations to review**: the text of the « video out of sight » setting (lot 62) and the six « why » texts
  (lot 64), 19 languages each.
- **The four asks of 2026-11-17**: Shuffle of a playlist or a mix (an artist never returns at once); add to an imported
  playlist on the phone; close and reopen: « From » stays; no mini player card at the foot of Your library.
- **Lot 49, comma names**: « Tyler, The Creator » should be one artist (and the four others listed in the plan). Tell us
  any other comma name you see.
- **Lot 47, channel picture**: play a song by « prodphanda », wait about 10 s: its picture shows beside the title.
- **Lot 50**: the next Beta brings the embed and the Beta News Ping role; the Stable promotion, the Updates Ping.
- **Lot 51**: the Rich Presence artist picture, with a real Discord session.
- **Lot 52**: « Rescan » on a big folder, then the bar in Settings › Accounts. The lyrics glide: a real song with real
  lyrics, light theme, 375 px, reduced motion on.
- **Lot 54**: paste a real Discord attachment link with Ctrl+V (and an expired one).
- **Lot 56**: a long DJ set with the chapters setting on: Next and Previous, remove a part from Up next, Shuffle, quit and
  reopen in the middle of it.
- **Lot 57**: after installing a Beta, double-click a `.lmix` (app closed, then open). Uninstall, and check that « Open
  with Legato » is gone.
- **Not reported yet**: a Discord picture on a share link and on the share web page; the Adaptive Sound icons under the
  volume; Back on the phone from several pages and after a reopen; the Home flowing background (Appearance, off by
  default).
- **Right to left** (Arabic, Hebrew): never looked at on a screen; machine translations to review.

## Open
- **Channel picture never tried for real** (`91a7b86c`, `ab016e43`): no real YouTube call yet.
- **Android crackle** (lot 53, `390e82fe`): trials in plan-v2's order. By default no audio context exists, so the fix
  does not touch a default install: if the crackle stays, look elsewhere.
- **Imported playlists and Sync**: until both PCs run this build, a PC that still has the older one can erase a song added
  to an imported playlist when it re-imports, and its newer file erases it on the other PC.
- **Up next by chapter** (`742e088f`): Next on the last part restarts at the video's start; after a shuffle, the parts
  before the current one play after it; a saved Live Editor edit is not applied while the video is split.
- **Discord paste and drop** (`9edf6fad`, `68638508`): a Discord link dropped on a text field starts the download
  instead of inserting text; a second Ctrl+V handler doubles the one in `App.tsx`.
- **Lyrics glide** (`84ea321d`): a line arriving within 650 ms of the previous glide cuts the rest of that glide.
- **Idle YouTube embed** (`611c22c2`): not built. Measure first (Task Manager, WebView2 processes, a fade over ten songs).
- **`.legatosync` double-click and drop**: not built (no route writes that file yet).
- **Not run on a device**: Android Back (`b9d175f6`, reasoned from the Kotlin, never run on Android 16 / targetSdk 37);
  the Discord picture from the real CDN; a real QR scan; every screen of lots 59 to 65.
- **Rust of lots 59 to 65**: targeted tests only. The full `pnpm check`, the workspace clippy and `pnpm e2e` have not run
  locally since lot 58; CI runs them on push.
- **Frozen or blurred window** (the owner's other PC, Beta 1.1.973): if it comes back, look for a `webview` line in the
  diagnostics log (Settings › About › Copy diagnostics). Cause not proven.
- **Never run for real**: plan-v2 › Check live in the real app.
- **For Opus**: a Subsonic playlist half-made if adding its tail fails after creation; the cast server stays open after the
  song ends (the token protects it); a public podcast name that resolves to a private address (DNS rebinding) still passes;
  the gamepad is polled every frame in living-room mode even with no pad; the Stream Deck inspector accepts more addresses
  than the plugin; the e2e failed once at the home screen (a dialog left open), not reproduced; one `cargo test` of the
  legato crate froze 6 minutes once (while a dev app ran), not reproduced: watch CI; the Android target was never compiled
  here.
- **Left, for a run that can check it**: MPRIS and macOS Now Playing (CI skips the legato crate there); WASAPI exclusive;
  the website in Arabic and Hebrew; plural forms beyond one / other in ar and he; CI speed-ups (nextest, sccache: one CI
  trial each); the full `pnpm bench`.
- **For the owner**: a share link with a Discord picture (version 4) is unreadable for older installed versions (they say
  « update the app »); Quiet at -20 LUFS against Spotify's -19; the Adaptive Sound icons; the flowing background's static
  look when `homeFlow` is off; the algorithm's weights by ear; a YouTube channel identifier stored with each song;
  preloading the next song's artist (a privacy decision); the site redesign's taste; the theme and plugin gallery;
  profiles on a PC; the Discord bot and its signature; the Arabic and Hebrew review; a « sans paroles » filter for Focus
  (the library has no lyrics flag); the lines that need an account or a real network (Spotify and SoundCloud sends,
  concerts, TIDAL / Qobuz links, watch-page autoplay).

## Next
1. **Opus reviews `30c6a612..14aa2d60`** (12 commits: the phone Radio tab through the session signals).
2. `docs/notes/plan-v2.md` line 773: server songs levelled (Jellyfin's `NormalizationGain`, Plex's loudness: other scales).
3. The Subsonic playlist rename (`updatePlaylist`); Jellyfin and Plex stay read-only.
4. Slices 4 and 5 of `docs/recommendation.md`.

The remaining plan lines need a real account or network, an owner's choice, a Linux or macOS machine, or a device. A later
run takes what needs nobody, one line at a time, in plan-v2's order. One step = `graphify query` first, code and targeted
tests, one local commit on `platforms`, its plan-v2 line ticked, `graphify update .`.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
`gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
`releases/latest/download/latest.json` after.

## Reprendre l'orchestration
For a new orchestrating session with an empty context:
1. Read `CLAUDE.md`, this handoff, then only the useful parts of `docs/notes/plan-v2.md`. The owner's private notes
   (`docs/notes/report-asks.md`, `report-2026-11-12.md`, `report-2026-11-18.md`, `report-orchestrator-prompt.md`) are
   untracked: read them for what was asked and decided, never copy them into tracked files.
2. **Sessions**: one per model, reused (send a message) rather than restarted: one Sonnet (builds, `claude-sonnet-5-5`),
   one Opus (reviews and designs, `claude-opus-5-5`; `start_session` ignores a model dearer than the orchestrator's), one
   Haiku (docs, handoff, reports, checks). The builder works in small slices; the reviewer rereads each batch and does the
   delicate parts (startup, security, the release).
3. **Briefs**: verify each fact against the code or git before writing it, and give file and doc references.
4. One writer at a time on the checkout. Stage by name (`git add <file>`), never `git add -A` or `.`. Commit only what the
   task names. No push without the owner's word.
5. **Heavy checks**: only after the local free-PC check, with the limits in « Where things stand »; targeted first.
6. End markers go in `docs/notes/report-inbox.md` (`Clôture N finie : <hash>`); the orchestrator merges them into the
   private report and empties the inbox. The weekly usage cap is 75 %: plan the work to fit under it.

## Two PCs
The owner works on two Windows PCs, each with `C:\dev\music-app`, kept alike through GitHub. The first holds the signing keys
and the Android tools (`C:\dev\android`). Each PC's own setup is in Claude Code's private memory on that PC, not in the repo.

## Traps not written elsewhere
- `[skip release]` in a push's head commit skips that push's Beta: keep it off the commit that ends a push you want released.
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
- Google limits an address after about 40 anonymous searches, and refuses lists and radios for 15 minutes after a refusal:
  expect it in any search test, never route around it.
- The website: `app/[lang]`'s static export needs one language besides English in `COPIES`; `npx tsc -p site` shows stale
  `.next/types` errors until `npx next build` rewrites them. The first `pnpm build` of `site/` can stop on Next's own
  update check (`SecurityFatalError`, Next 16.4.4 queries npm): a second run passes; upgrading Next is the owner's call.
- Claude desktop's tools run inside an MSIX package and see a stale copy of `%APPDATA%` (`docs/development.md` › Two dev
  libraries).
- Ad-hoc Python edits of CRLF files through `open()` keep CRLF on Windows; a `\n` typed inside a non-raw string in a script
  that writes JS or TS becomes a real newline: write those with the edit tool.

## History
Releases 0.1 to 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13), 1.1 and the v2 plan (Stable
1.1.479, 2026-10-31), Stable 1.1.681 (2026-11-05), Beta 1.2.1 (the first on the 1.2 line), Stable 1.2.10 (2026-11-14), Beta
1.2.41 (2026-11-15). The recommendation algorithm, the lots 39 to 65 and the Discord pings are in the release notes and in
`git log`. Reviews 23 to 25 were run by Sonnet in the Opus session; that session was switched to Opus 5.5 only afterwards.
