# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-12 (the autonomous run's window 6 closed;
Opus has reread everything, last reread `03ced7ce`).

## Where things stand
- **Stable** 1.1.681 (2026-11-05): Windows installer, `latest.json`, the Android APK. **Beta** 1.1.801 (2026-11-07):
  an Android Java crash now lands in Copy diagnostics (for the QR-scan crash). GitHub's master = `8e9fb3f`.
- **platforms** = master (`80310d3`, pushed) + 84 local commits (`git log origin/master..platforms | wc -l`, this
  handoff included), none seen on a screen or heard. The reports (untracked, French): `docs/notes/report-2026-11-11.md`
  (windows 1–4) and `docs/notes/report-2026-11-12.md` (windows 5–6: commits in order, what to try, what was decided
  alone, the questions for the owner: none open). Nothing is pushed: pushes go `platforms:master`, only on the owner's
  word; docs only: `[skip release]` in the last commit's first line.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681): waiting for a moderator. Each new Stable needs a new
  manifest (`packaging/README.md`).
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages. The owner's answer on the push:
  not yet, they try `pnpm dev` first.
- **Never tried for real**: plan-v2 › Check live in the real app. The owner's finds there come first.
- **Untracked, never committed**: `docs/notes/report-*.md` and `docs/notes/report-inbox.md` (the owner's reports, in
  French) and the old transcript `2026-10-30-001238-…txt` at the root.

## Try first (the owner)
- Radio page: starter stations (no station kept yet), the station icons, Next / Previous in a list and on a station
  at the end of a list (it pauses, no error).
- « Add to playlist » for a song not in the library, from the player, Up next and a search result.
- « Next » on the last song with Repeat off: it stops and waits at the start.
- A song's « Credits… » and an artist's « Short bio » (MusicBrainz and Wikipedia, real answers).
- Tempo written from Edit song info, then read back in another player: FLAC, MP3 and M4A.

## Next
The first open lines of plan-v2 that need nobody, in the plan's order:
- Equalizer presets per output device (headphones vs speakers) and AutoEQ profiles for known headphones.
- Mixes: Last.fm "Discoveries" and "Never in mixes" on a discovered song (the owner's Last.fm key).
- The end of Practice mode: key and chords shown, a metronome (the A–B loop is done).
- Credits and artist pages: built (song credits, Wikipedia bio); the plan line stays open until ticked.
Focus / workout sessions wait on the owner's word on what a session is. Then Features › Medium, Low, Workflow and
Optimisation in the plan's order.

**For Opus** (delicate or large): the security pass of the whole app (IPC commands, deep links, the `art` scheme, the CSP,
plugins, the phone remote and the overlay), splitting `src-tauri/src/lib.rs` and `crates/core/src/library.rs`, the `L`
lines (Linux and macOS builds, rooms over the internet, the mobile version, Cast, WASAPI), right-to-left languages (the
translations), faster CI (not testable here), YouTube embeds reused, a crash without a Rust panic in the diagnostics.

**For the owner**: their tries above and of everything built, the Discord profile's signing choice, snap layouts at the
PC, the QR-scan crash on Android (Copy diagnostics from Beta 1.1.801), Spotify and SoundCloud (accounts, terms), the
`.lmix` that carries local audio (export warning, personal servers; the compact link is done), what a Focus session is,
and the push.

One step = `graphify query` first, code and tests, `pnpm check` green, one local commit on `platforms`, its plan-v2
line ticked with what wasn't tried for real, `graphify update .`.

Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing). A Beta: `/release-check`, then
`git push origin platforms:master`. Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
`gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
`releases/latest/download/latest.json` after.

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
The 0.1 releases, 1.0 (the redesign), the rename to Legato (2026-10-29), 1.1 and the v2 plan (Stable 1.1.479,
2026-10-31); then imports, lyrics, the phone (Android from 2026-11-02, its updates in the app), device sync, the
visualizer's v2, listening rooms, personal servers, Against Liner, the website in 18 languages; Stable 1.1.681
(2026-11-05), Betas up to 1.1.795 (2026-11-07). The rest: `git log`, the release notes.
