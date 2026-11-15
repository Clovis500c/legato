# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-15 (clean-up of the plan and the docs).

## Where things stand
- **master** = `9ad1e6f7` (the Discord ping titles, lot 50, are in it). Stable **1.2.10** (tag `v1.2.10`), unchanged.
- **platforms** = master + the clean-up commit that adds this line's version of the handoff and plan (`git log --oneline
  origin/master..HEAD`). Nothing else is waiting. Only the owner's word pushes.
- **Next Beta**: the push of the clean-up releases it. It is the first Beta to test the Discord pings (lot 50), and it
  carries the plan's clean-up. `node scripts/release.mjs --dry-run` says v1.2.40 once this commit is on master.
- **Version rule** (`CONTRIBUTING.md` › Version): `MAJOR.MINOR` is in `src-tauri/tauri.conf.json` (`1.2`); the patch is
  the number of commits since the base in `BASES` (`scripts/release.mjs`), with `n % 1000`. A bump of `MAJOR.MINOR` is
  the owner's decision.
- **Before any push**: `pnpm check` green; `node scripts/budget.mjs` (JS 332 of 340 kB gzip: little room, lazy-load new
  features); `cargo clippy --workspace --all-targets -- -D warnings`; `pnpm build` in `site/`; a clean tree; **`pnpm e2e`**
  when the push touches startup (`setup` in `src-tauri/src/lib.rs`, anything that reads `AppState`); and
  `git log --name-only --format= origin/master..HEAD | grep -i notes/report` must print nothing. A push to master is a
  Beta release.
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **Reports** (`docs/notes/report*.md`, the owner's French reports) are git-ignored and never committed.
- **The rename is done.** The one catch-up for data on disk is `src-tauri/src/rename.rs` (plus the old Run entry in
  `autostart.rs` and the old-install cleanup in `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename
  catch-up » lists what to delete.
- **Android**: the release job compiles the whole crate; desktop-only code sits behind `#[cfg(desktop)]` or
  `#[cfg(windows)]`. The Android target and the Kotlin toolchain are not usable on this PC: CI's android job is the check.
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, not yet Arabic or Hebrew.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681) waits for a moderator; each new Stable needs a new manifest
  (`packaging/README.md`).
- **Discord pings** (lot 50, `CONTRIBUTING.md` › Releasing): MonitoRSS reads the releases feed. A Beta's title ends with
  "beta" and gets an embed with the Beta News Ping role; the promotion renames it, and the new Stable title gets the
  Updates Ping. Betas released before 2026-11-15 have no "beta" in their title and are not re-announced.

## The algorithm
`docs/recommendation.md` is where it lives: the design, the weights (all first guesses, never heard by ear), the measured
numbers. In short: `taste_signals` (Rust, one pass) → `player/taste.ts` (store) → `player/score.ts` (pure: profiles,
z-scores, explore dose by Variety, diversity re-rank) used by Shuffle, the end of Up next and « Start a mix from this
song »; the Mixes page's « Like <title> » mixes are built in Rust (`mixes()`). Variety is the one control.

## Try first (the owner)
Only what is new or still untried. Most of the rest is behind a setting that is **off** by default.
- **Lot 49, comma names**: « Tyler, The Creator » should be one artist (one « TT » tile). So should « Earth, Wind & Fire »,
  « Crosby, Stills, Nash & Young », « Crosby, Stills & Nash » and « Emerson, Lake & Palmer ». Tell us any other comma name
  you see. A « Never in mixes » you set on those artists must be set again.
- **Lot 47, channel picture**: play a song by « prodphanda », wait about 10 s: its picture shows beside the title, and its
  artist page opens.
- **Lot 48, From label**: Now Playing says « From », then the playlist's picture and the name in bold (desktop and phone).
- **Not reported yet**: a Discord picture on a share link and on the share web page; the Adaptive Sound icons under the
  volume; Back on the phone from several pages and after a reopen; the Home flowing background (Appearance, off by
  default; it stops under Windows' reduce-motion).
- **Lot 50, next Beta**: the Beta embed should appear with the Beta News Ping role, and the Stable promotion should ping
  the Updates Ping. Nothing was tested for real.
- **Right to left** (Arabic, Hebrew): never looked at on a screen; machine translations to review.

## Open
- **Channel picture never tried for real** (`91a7b86c`, `ab016e43`): no real YouTube call yet; the `browse` shape of an
  uploader's channel is unknown and ytmusicapi's shape was not re-read.
- **Not run on a device**: Android Back (`b9d175f6`: reasoned from the Kotlin, never run on Android 16 / targetSdk 37); the
  Discord picture from the real CDN; a real QR scan.
- **GPU resets on the owner's PC under full builds**: cause not found; not the flowing background (believed, not measured).
  Until it is known: cap jobs at 4, and run one heavy command at a time.
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
  « Up next » per chapter; the website in Arabic and Hebrew; plural forms beyond one / other in ar and he; faster CI; reused
  YouTube embeds; the full `pnpm bench`.
- **For the owner**: a share link with a Discord picture (version 4) is unreadable for older installed versions (they say
  « update the app »); Quiet at -20 LUFS against Spotify's -19; the Adaptive Sound icons; the flowing background's static
  look when `homeFlow` is off; the algorithm's weights by ear; a YouTube channel identifier stored with each song;
  preloading the next song's artist (a privacy decision); Last.fm / ListenBrainz as a source; the site redesign's taste;
  the theme and plugin gallery; profiles on a PC; the Discord bot and its signature; the Arabic and Hebrew review; the
  lines that need an account or a real network (Spotify and SoundCloud sends, concerts, TIDAL / Qobuz links, watch-page
  autoplay).

## Next
The remaining plan lines need a real account or network, an owner's choice, a Linux or macOS machine, or a device. A later
run takes what needs nobody, one line at a time, in plan-v2's order. One step = `graphify query` first, code and tests,
`pnpm check` green, one local commit on `platforms`, its plan-v2 line ticked, `graphify update .`.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
`gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
`releases/latest/download/latest.json` after.

## Reprendre l'orchestration
For a new orchestrating session with an empty context:
1. Read `CLAUDE.md`, this handoff, then only the useful parts of `docs/notes/plan-v2.md`. The owner's private notes
   (`docs/notes/report-asks.md`, `report-2026-11-12.md`, `report-orchestrator-prompt.md`) are untracked: read them for what
   was asked and decided, never copy them into tracked files.
2. **Sessions**: one per model, reused (send a message) rather than restarted: one Sonnet (builds, `claude-sonnet-5-5`),
   one Opus (reviews and designs, `claude-opus-5-5`; `start_session` ignores a model dearer than the orchestrator's), one
   Haiku (docs, handoff, reports, checks). The builder works in small slices; the reviewer rereads each batch and does the
   delicate parts (startup, security, the release).
3. **Briefs**: verify each fact against the code or git before writing it, and give file and doc references.
4. One writer at a time on the checkout. Stage by name (`git add <file>`), never `git add -A` or `.`. Commit only what the
   task names. No push without the owner's word.
5. **Heavy checks** (`pnpm check`, `cargo clippy`, `cargo test`, `pnpm vite build`, `pnpm build`, `pnpm e2e`): one at a time,
   in the foreground with a 10-minute timeout, at most 4 jobs (`CARGO_BUILD_JOBS=4`) and below-normal priority, so the
   owner's PC stays responsive. Never a `pnpm check` in the background: it stalls the chain.
6. End markers go in `docs/notes/report-inbox.md` (`Clôture N finie : <hash>`); the orchestrator merges them into the
   private report and empties the inbox. The weekly usage cap is 75 %: plan the work to fit under it.

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
Releases 0.1 to 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13), 1.1 and the v2 plan (Stable
1.1.479, 2026-10-31), Stable 1.1.681 (2026-11-05), Beta 1.2.1 (the first on the 1.2 line), Stable 1.2.10 (2026-11-14). The
recommendation algorithm, the lots 39 to 50 and the Discord pings are in the release notes and in `git log`. Reviews 23 to
25 were run by Sonnet in the Opus session; that session was switched to Opus 5.5 only afterwards.
