# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-13 (night window closed).

## Where things stand
- **master** = `a5339fed`, pushed. **Beta 1.1.932** came out from it (CI green). **Stable** 1.1.681 (2026-11-05): Windows
  installer, `latest.json`, the Android APK.
- **platforms** = master + the local commits (`git log origin/master..platforms --oneline | wc -l`, this handoff
  included). None is pushed. Opus has reread everything, up to `fb44c034`.
- **The rename is done** (Beta 1.1.932): Music App → Legato in every format (QR prefix `LG1:`, `_legato._tcp`,
  `.legatosync`, `legato://` links). The one catch-up for data on disk is `src-tauri/src/rename.rs` (plus the old Run
  entry in `autostart.rs`, the old-install cleanup in `src-tauri/windows/hooks.nsh`): the plan line « Remove the rename
  catch-up » lists what to delete, once every PC of the owner has the new name.
- **Cost, accepted**: old share links and QR codes stop working; a PC on an older version is invisible on the local
  network and in the sync folder until it's updated.
- **Push rule**: before any push, run `pnpm check`, `node scripts/budget.mjs` (JS budget: 306 of 340 kB gzip),
  `cargo clippy --workspace --all-targets -- -D warnings` (the CI's clippy is newer than the local one), and `pnpm build`
  in `site/`; `git ls-files docs/notes | grep report` must be empty. A push to master is a Beta release.
- **Stable**: only on the owner's word, never on a Beta's green CI.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681): waiting for a moderator. Each new Stable needs a new
  manifest (`packaging/README.md`).
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, the Discord invitation included.
- **Never tried for real**: plan-v2 › Check live in the real app. The owner's finds there come first.
- **Untracked, never committed**: `docs/notes/report-*.md` and `docs/notes/report-inbox.md` (the owner's reports, in
  French) and the old transcript `2026-10-30-001238-…txt` at the root.

## Try first (the owner, Beta 1.1.932)
- Sync between the two PCs after the rename: a sync folder « Music App Sync » becomes « Legato Sync »; each PC finds the other.
- A new share link and QR code (`LG1:`), read back on the other PC.
- Icons in the built app (`d0db29ff`; `pnpm dev` doesn't show the release build's problem).
- Audiobook chapters (a real `.m4b` from Audible or iTunes; an mp3 book) and sleep at the end of a chapter.
- YouTube search while signed out: a song is found and plays.
- Then the settings that are off, to switch on: volume per source (Playback), Focus and workout sessions (player menu),
  Last.fm suggestions (needs the owner's Last.fm key; asks once a day), the blind test (app menu; a library of 8+ songs).

## Open
- **For Opus**: finish the whole-app security pass. Still to read: the arguments of each IPC command. Still open
  (`fb44c034`): the `art` scheme answers third-party pages opened in the app with `ACAO: *` (local covers, the user's
  images). Also: faster CI (not testable here), splitting `src-tauri/src/lib.rs` and `crates/core/src/library.rs`, a crash
  without a Rust panic in the diagnostics, the reuse of YouTube embeds, sweet fades.
- **For the owner**: Discord (the sign-in waits for the application ID); the per-output equalizer and AutoEQ (skipped:
  the engine knows only the default output; AutoEQ needs a data and licence choice); Stream Deck; right-to-left
  translations; the photos of the big title (which side).

## Next
The first open lines of plan-v2 that need nobody are done or blocked on a choice above. Then Features › Medium, Low,
Workflow and Optimisation in the plan's order, one line at a time.

**For Opus**: see Open above.
**For the owner**: their tries above; Discord's application ID; the equalizer / AutoEQ and Stream Deck decisions;
right-to-left translations; the photos side; the QR-scan crash on Android (Copy diagnostics from Beta 1.1.801);
Spotify and SoundCloud (accounts, terms); the `.lmix` that carries local audio (export warning, personal servers).

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
- Headless emulator: `emulator -avd legato36 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim`;
  stop it after a test. Never answer Windows' firewall or any system prompt.
- `pnpm notices` (cargo-about) once on a new PC: a release build stops without `src-tauri/third-party-licenses.html`.
- Google limits an address after about 40 anonymous searches (a 5-minute block, then one every 15 s): expect it in any
  search test, never route around it.
- The website: `app/[lang]`'s static export needs one language besides English in `COPIES`; `npx tsc -p site` shows
  stale `.next/types` errors until `npx next build` rewrites them; its dev server can keep a stale error after routes
  move: restart it.
- Claude desktop's tools run inside an MSIX package and see a stale copy of `%APPDATA%` (`docs/development.md` › Two
  dev libraries).

## History
The 0.1 releases, 1.0 (the redesign), the rename to Legato (2026-10-29, finished 2026-11-13 in every format), 1.1 and
the v2 plan (Stable 1.1.479, 2026-10-31); then imports, lyrics, the phone (Android from 2026-11-02, its updates in the
app), device sync, the visualizer's v2, listening rooms, personal servers, Against Liner, the website in 18 languages;
Stable 1.1.681 (2026-11-05), Betas up to 1.1.795 (2026-11-07), Beta 1.1.896 (2026-11-12), Beta 1.1.932 (2026-11-13).
The rest: `git log`, the release notes.
