# Handoff

Where the work stands, for a session with no history here. Read this first, then only the parts of
[plan-v2.md](plan-v2.md) you need. Rewrite it, short, when a branch, a release or the next step changes; its older
versions are in git (`git log -p -- docs/notes/handoff.md`). Updated 2026-11-08: Beta 1.1.801 out, three of the
owner's asks done on `platforms`, not pushed.

## Where things stand
- **Stable** 1.1.681 (2026-11-05): Windows installer, `latest.json`, the Android APK. **Beta** 1.1.801 (2026-11-07):
  an Android Java crash now lands in Copy diagnostics (for the QR-scan crash). GitHub's master = `8e9fb3f`.
- **platforms** = master + local commits for the next Beta (`git log origin/master..platforms`): the search bar
  always in the window's middle, Settings' visualizer style as a dropdown with previews, Now Playing's video or cover
  switch as icons.
  Pushes go `platforms:master`, only on the owner's word; docs only: `[skip release]` in the last commit's first line.
- **winget**: microsoft/winget-pkgs#474341 (Stable 1.1.681): CLA signed, Microsoft's validation passed, waiting for a
  moderator. Each new Stable needs a new manifest (`packaging/README.md`).
- **Website** https://clovis500c.github.io/legato/, deployed from master: 18 languages, the visitor's own one first.
- **Never tried for real**: plan-v2 › Check live in the real app. The owner's finds there come first.
- **Untracked, never committed**: `docs/notes/report-*.md` (the owner's reports, in French) and the old transcript
  `2026-10-30-001238-…txt` at the root.

## Next
1. The owner's asks of 2026-11-07, evening (plan-v2, top): the QR-scan crash on Android (waiting for their Copy
   diagnostics from Beta 1.1.801 after a scan), the artists' round pictures on the big title, Up next's new look.
   Then fixes from their tries (plan-v2 › Check live).
2. Against Liner 12 (a moving cover background, our own WebGL shader, under 3 % CPU), 11 (share links: a static page on
   the website reads the playlist from the link's fragment; `music_core::share`'s zlib + base64url, read in a browser by
   `DecompressionStream('deflate')`), 6 (snap layouts).
3. The owner's choices of 2026-11-07: the lyrics' capitals in normal case, classic skins' mini layout (the video at
   200 px beside it), discovery from MusicBrainz, 17's internet half (Nostr relays, Cloudflare's STUN, a privacy row),
   Linux and macOS builds on GitHub's Actions.
4. Then plan-v2's other open lines: milestone 3 Platforms, Features › High, then Medium.

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
