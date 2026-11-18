# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-19 (night: two Betas).

## Where things stand
- **master** = `3e3b6587`, Beta **1.2.101** (2026-11-18, 23:21 UTC). Before it, Beta **1.2.95** (`0ab19179`, 22:57 UTC).
  Both: check and release green, APK attached. Stable **1.2.10**, unchanged.
- **platforms** = master + 11 local commits, **none pushed**: the 10 commits `fd576286..2942c8b1` (reviewed by Opus with
  his fixes) and this handoff. Only the owner's word pushes ("push").
- **Next Beta**: `node scripts/release.mjs --dry-run` gives v1.2.112 (checked after this commit). A push to master releases it.
- **Never put `[skip release]` on the last commit of a push you want as a Beta**: `release.yml` reads the head commit's
  first line.
- **Version rule** (`CONTRIBUTING.md` › Version): `MAJOR.MINOR` is in `src-tauri/tauri.conf.json` (`1.2`); the patch is the
  number of commits since the base in `BASES` (`scripts/release.mjs`), with `n % 1000`. A bump of `MAJOR.MINOR` is the
  owner's decision.
- **Heavy commands** are allowed, with limits, after a local free-PC check (a private script kept outside the repo; see the
  orchestrator's notes). Limits: 4 jobs (`CARGO_BUILD_JOBS=4`), 4 test threads, below-normal priority, one heavy command at a
  time, targeted first. The full `pnpm check`, `pnpm e2e` and `pnpm build` only when a push needs them. GitHub's CI is the gate.
- **Before any push**: a clean tree; `git log --name-only --format= origin/master..HEAD | grep -i notes/report` must print
  nothing; `pnpm e2e` when the push touches startup (`setup` in `src-tauri/src/lib.rs`, anything that reads `AppState`).
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **Reports** (`docs/notes/report*.md`) are git-ignored and never committed.
- **The rename is done.** The one catch-up for data on disk is `src-tauri/src/rename.rs` (plus the old Run entry in
  `autostart.rs` and the old-install cleanup in `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename catch-up »
  lists what to delete.
- **Android**: desktop-only code sits behind `#[cfg(desktop)]` or `#[cfg(windows)]`. The Android target and the Kotlin
  toolchain are not usable on this PC: CI's android job is the check.
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, not yet Arabic or Hebrew.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681) waits for a moderator; each new Stable needs a new manifest
  (`packaging/README.md`).
- **Discord pings** (`CONTRIBUTING.md` › Releasing, `.github/workflows/release.yml`): MonitoRSS reads the releases feed. A
  Beta's title is "Legato vX.Y.Z beta" and gets an embed with the Beta News Ping role; the promotion renames it to
  "Legato vX.Y.Z", and the Updates Ping follows. Titles checked with `gh`; the Discord messages themselves not seen here.
- **Dependabot**: 2 moderate alerts open on GitHub; the update runs for the site's Next failed on 2026-11-18.

## The algorithm
`docs/recommendation.md` is where it lives: the design, the weights (first guesses, never heard by ear), the measured
numbers. Candidates: the library, the YouTube Music radios of the last songs (merged, with votes), the related artists of a
mix's top song, and « New for you » (Home's shelves ranked by your taste). The score ranks them: fit × preference, then
diversity. Session signals (skips, replays, pairs skipped twice) move it. Each pick shows why (`pickWhy.ts`). Google's
refusal pauses lists, radios and artist pages for 15 minutes (`searchpace::Quiet`).

## Try first (the owner)
Only what is untried. Most of the rest is behind a setting that is **off** by default.
- **Sync, your three asks**: (1) two PCs on this build: change a playlist on one, the other has it in under 10 s;
  (2) phone: change something, go to Home at once, the PC has it in under 30 s; (3) come back to the app after a change on
  the PC: it arrives without visiting the Sync screen. On Android, leave the app while a change arrives on the PC.
- **Lots 59 to 65**: right-click the visualizer (Essentials, then Standard); the TV home's Up next row (six tiles, signed
  out too); « Translate… » under sung lines; no mini player card under the sidebar, and a YouTube video plays out of sight
  unless the mini player is on; five bottom tabs on the phone at 375 px; a blind-test round that times out (30 s); the
  reason under each Up next title; replay a song the same day and watch Shuffle (not heard by ear).
- **Lots 66 and 67**: « New for you » on Home, signed in; a mix from a YouTube song; a blind test from one playlist and
  « Guess the artist »; the translation shown in Karaoke.
- **Subsonic, rename a playlist** on a Navidrome: the other PC or the next sync keeps the new name; with the server off, the
  old name comes back.
- **Stream Deck « Like » key**: never loaded on a real deck.
- **Machine translations to review**: the « video out of sight » setting (lot 62), the six « why » texts (lot 64), « New
  for you » (lot 66), the blind-test texts (lot 67), the Subsonic rename message (19 languages each).
- **The four asks of 2026-11-17**: untried; `git log 4a921e9f..dae41ca2`.
- **Lot 49, comma names**: « Tyler, The Creator » should be one artist (and the four others listed in the plan).
- **Lot 50**: the next Beta brings the embed and the Beta News Ping role; the Stable promotion, the Updates Ping.
- **Lot 54**: paste a real Discord attachment link with Ctrl+V (and an expired one). **Lot 57**: double-click a `.lmix` after
  installing a Beta; uninstall, and check that « Open with Legato » is gone.
- **Right to left** (Arabic, Hebrew): never looked at on a screen; machine translations to review.

## Open
- **Android background sync** (plan line, unticked): no notification and no WorkManager, so no sync long after leaving the
  app. Kotlin not compiled here; CI checks it.
- **Phone Radio tab** (`30c6a612`): it ignores « Entrées de la barre latérale » like Home and Mixes do. The owner decides.
- **Subsonic playlist order** is not sent to the server; that plan line stays unticked on purpose.
- **Radio station metadata (ICY)**: skipped. It means touching the HTTP engine every radio uses; only a real station can check it.
- **Plex loudness**: not done (needs a real server and a doc). Jellyfin's −18 LUFS target is an unverified assumption.
- **Channel picture never tried for real** (`91a7b86c`, `ab016e43`): no real YouTube call yet.
- **Not run on a device**: Android Back (`b9d175f6`, never run on Android 16 / targetSdk 37); the Discord picture from the real
  CDN; a real QR scan.
- **Frozen or blurred window** (the owner's other PC, Beta 1.1.973): if it comes back, look for a `webview` line in the
  diagnostics log (Settings › About › Copy diagnostics). Cause not proven.
- **Never run for real**: plan-v2 › Check live in the real app.
- **Left, for a run that can check it**: MPRIS and macOS Now Playing (CI skips the legato crate there); WASAPI exclusive; the
  website in Arabic and Hebrew; plural forms beyond one / other in ar and he; CI speed-ups (nextest, sccache); the full `pnpm bench`.
- **For the owner**: the plan's remaining lines (accounts, Plex, taste, the Xbox Game Bar widget, AutoEQ, concerts, a « sans
  paroles » filter for Focus, which the library cannot support yet: it has no lyrics flag); a share link with a Discord picture
  (version 4) is unreadable for older installed versions; Quiet at -20 LUFS against Spotify's -19; the algorithm's weights by
  ear; the Arabic and Hebrew review; the Discord bot and its signature; the lines that need an account or a real network.

## Next
Nothing left that can be built without the owner. In order, when he is back:
1. His word on the 11 unpushed commits (`push`), then the Beta.
2. Try the sync (his three asks) and the Android background; say what happened.
3. Decide whether the phone's tabs follow « Entrées de la barre latérale ».
4. Then the plan lines that need him.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
`gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
`releases/latest/download/latest.json` after.

## Reprendre l'orchestration
For a new orchestrating session with an empty context:
1. Read `CLAUDE.md`, this handoff, then only the useful parts of `docs/notes/plan-v2.md`. The owner's private notes
   (`docs/notes/report-asks.md`, `report-2026-11-12.md`, `report-2026-11-18.md`, `report-2026-11-19.md`,
   `report-orchestrator-prompt.md`) are untracked: read them for what was asked and decided, never copy them into tracked files.
2. **Sessions**: one per model, reused rather than restarted: one Sonnet (builds, `claude-sonnet-5-5`), one Opus (reviews
   and designs, `claude-opus-5-5`), one Haiku (docs, handoff, reports, checks). The builder works in small slices; the reviewer
   rereads each batch and does the delicate parts (startup, security, the release).
3. **Briefs**: verify each fact against the code or git before writing it, and give file and doc references.
4. One writer at a time on the checkout. Stage by name (`git add <file>`), never `git add -A` or `.`. Commit only what the task
   names. No push without the owner's word.
5. **Heavy checks**: only after the local free-PC check, with the limits in « Where things stand »; targeted first.
6. End markers go in `docs/notes/report-inbox.md` (`Clôture N finie : <hash>`); the orchestrator merges them into the private
   report and empties the inbox. The weekly usage cap is 75 %: plan the work to fit under it.

## Two PCs
The owner works on two Windows PCs, each with `C:\dev\music-app`, kept alike through GitHub. The first holds the signing keys
and the Android tools (`C:\dev\android`). Each PC's own setup is in Claude Code's private memory on that PC, not in the repo.

## Traps not written elsewhere
- `[skip release]` in a push's head commit skips that push's Beta: keep it off the commit that ends a push you want released.
- Google refuses lists, radios and artist pages for 15 minutes after a refusal (`searchpace::Quiet`): never retry in a loop,
  never route around it. Expect it in any search test.
- `app.state()` before `app.manage()` panics at launch (`36785ec2`, fixed in `468c51ab`): only the CI's e2e caught it.
- Tauri 2.12's `focused`, `focusable` and `skip_taskbar` exist only on desktop: keep them behind `#[cfg(desktop)]`.
- macOS has only 127.0.0.1 on its loopback: a test that binds 127.0.0.2 must skip there.
- Node 22's `node --test` wants its glob in quotes.
- Settings labels: an `id` is never changed (it is the `data-setting`, the locale key while there is no label, and the search
  key); a renamed setting's spoken name goes through `labelOf`, not `tr('<id>')`.
- **CRLF / LF**: a PC whose working copy is CRLF fails `no_sync_command_locks_the_library` (it wants LF). Convert
  `src-tauri/src/*.rs` to LF locally; git sees no real change, so an empty-diff `M src-tauri/src/servers.rs` in `git status`
  is that artefact: never commit it.
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
- The website: `app/[lang]`'s static export needs one language besides English in `COPIES`; `npx tsc -p site` shows stale
  `.next/types` errors until `npx next build` rewrites them. The first `pnpm build` of `site/` can stop on Next's own update
  check (`SecurityFatalError`, Next 16.4.4 queries npm): a second run passes; upgrading Next is the owner's call.
- Claude desktop's tools run inside an MSIX package and see a stale copy of `%APPDATA%` (`docs/development.md` › Two dev
  libraries).
- Ad-hoc Python edits of CRLF files through `open()` keep CRLF on Windows; a `\n` typed inside a non-raw string in a script
  that writes JS or TS becomes a real newline: write those with the edit tool.

## History
Releases 0.1 to 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13), 1.1 and the v2 plan (Stable
1.1.479, 2026-10-31), Stable 1.1.681 (2026-11-05), Beta 1.2.1 (the first on the 1.2 line), Stable 1.2.10 (2026-11-14), Beta
1.2.41 (2026-11-15), Betas 1.2.95 and 1.2.101 (2026-11-18). The recommendation algorithm, the lots 39 to 67 and the Discord
pings are in the release notes and in `git log`. Reviews 23 to 25 were run by Sonnet in the Opus session; that session was
switched to Opus 5.5 only afterwards.
