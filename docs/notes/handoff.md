# Handoff

Where the work stands, for a session or an account with no history here. Read this first, then `CLAUDE.md` (rules, map
of the code), then only the parts of [plan-v2.md](plan-v2.md) you need (open work, by section). Rewrite this file when a
branch, a release or the next step changes. Its older versions (the run logs of 2026-10-31 to 2026-11-05) are in git:
`git log -p -- docs/notes/handoff.md`; each commit message says what it did and what wasn't tried for real.

Written 2026-11-05, late evening, after a clean-up (the owner's ask: another account with none of this context should
be able to take the project over).

## Where things stand

- **Released:** Stable and Beta are both **1.1.681** (`0c3561a`, 2026-11-05): the Windows installer, `latest.json` and
  the Android APK (`Legato_1.1.681_android-arm64.apk`). Stable was 1.1.479 before; its notes list the 133 changes since.
- **master** = `f10e9dc`: two `[skip release]` commits after 1.1.681 (release notes in full, the bench's numbers on the
  website). The website, https://clovis500c.github.io/legato/, is deployed from it.
- **platforms**, the work branch (local only) = master plus this clean-up's commits. Nothing half done, no stash, no
  other branch or worktree.
- **Untracked:** `docs/notes/report-*.md`, the owner's reports in French (what each autonomous run did, what to try).
  Never commit them; read them for context.
- **Never tried for real** (built and unit-tested, seen in the demo or on the emulator only): plan-v2 › Check live in
  the real app (25 lines). The owner tries them; what they find comes first.

## How to continue

1. The owner writes in French: answer in French with « tu » (the French interface says « vous »). Take their latest ask,
   or ask what they want. Their standing rules are in `CLAUDE.md` › Working with the owner; read them before anything
   else: no push without their word, no subagents or workflows unless they ask, real accounts are theirs, a Google
   refusal is never routed around.
2. If they only say "carry on": fixes from their tries first (plan-v2 › Check live), then plan-v2's open lines that need
   no account, smallest first:
   - Features, sorted › High: same loudness across sources (needs an ear), the accessibility pass, personal servers
     (Jellyfin / Navidrome need the owner's server), macOS and Linux builds.
   - Classic skins, the autopilot's next line, not started: decide first how a mini layout keeps YouTube's 200 × 200
     rule (the video at 200 px beside it, or Cover mode only).
   - Platforms: Connect Spotify's untried cases (`S`), public playlist links from more services (`S`).
   - Workflow (7 open), Optimisation (2), then Features › Medium (19) and Low (18).
3. One step = `graphify query` first, code and tests, `pnpm check` green, one local commit on `platforms` (Conventional
   Commits, with the attribution line your harness gives), its plan-v2 line ticked with what wasn't tried for real,
   `graphify update .`, and this file when the next step changes.
4. Releasing, only on the owner's word (`CONTRIBUTING.md` › Releasing):
   - A Beta: `/release-check`, then `git push origin platforms:master`. Docs or website only: `[skip release]` in the
     first line of the last commit.
   - Stable: `git fetch --tags`, `node scripts/promote.mjs --dry-run <version>`, then
     `gh workflow run promote.yml --repo Clovis500c/legato --ref master -f version=<version>`; check
     `releases/latest/download/latest.json` after.

## If the owner asks for an autonomous run

They did three (2026-10-31, 11-02, 11-03 to 11-05; their reports are the untracked `report-*.md`). The rules that
worked, on top of `CLAUDE.md`:

- Never a question, never a wait. A choice that's the project's: the option easiest to undo, written in its plan line
  ("decided alone (date): what, why"). What only the owner can do goes to plan-v2 › Waiting on the user; then the next
  step. A line that needs their eye or taste: built behind a setting that's off, so they judge it later.
- Each step as in "How to continue" above; no push, PR, merge, release or website deploy.
- Usage: `get_usage` after each step. From 90 % of the week no new step: finish the one in hand, then the end (95 % at
  the latest). After a 5-hour limit, resume (a CronCreate wake-up every 20 minutes; it ends with the session).
- The end: a report in French (`docs/notes/report-<date>.md`, untracked: done, to try, waiting for the owner), this file
  rewritten, the wake-up deleted, the report sent to the owner.

## Waiting on the owner

- Their tries of the Betas: plan-v2 › Check live in the real app, its last block first (2026-11-05: search, picture in
  picture, recap, genres, bookmarks, alarm, the phone's updates…).
- The phone: 1.1.681's APK installed by hand once (older APKs have no updater); later APKs come through the app
  (Settings › About). Background play behind other apps, the notification's controls and the phone ↔ PC sync were only
  tried on the emulator.
- The iPhone build: their signing choice (Apple Developer Program, or an unsigned .ipa). The Play Store or not (the
  APK's `REQUEST_INSTALL_PACKAGES` would have to go).
- A backup of the signing keys (below).
- Dependabot alert #6 (medium, dev only): `minimatch` 10.2.6 under ESLint and typescript-eslint, fixed in 11.0.1. The
  owner said later (2026-11-05).
- plan-v2 › Waiting on the user (9 lines: Discord's app name, a trademark search, Figma, SponsorBlock's default…) and
  › Not done yet.

## Keys, accounts and secrets (never in git)

| What | Where | If lost |
|---|---|---|
| Updater signing key | `~/.tauri/music-app.key` on this PC; GitHub secret `TAURI_SIGNING_PRIVATE_KEY` | Installed PCs refuse later updates: everyone reinstalls by hand |
| Android release keystore | `C:\dev\android\signing\legato-release.jks` (alias `legato`, its properties beside it), read through `src-tauri/gen/android/keystore.properties`; secrets `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD` | Phones must uninstall to take a later APK |
| GitHub | `gh` signed in as the repository's owner (`Clovis500c`) | Releases, promote and Actions need it |
| The owner's accounts (Google / YouTube, Spotify, Last.fm, ListenBrainz…) | Their dev app's keychain entries and WebView2 profile | Theirs: never sign in, type a password or accept a consent page |

GitHub's secrets can't be read back: the files on this PC are the only copies. Details: `CONTRIBUTING.md` › Releasing.

## On this PC

- `C:\dev\music-app` on Windows 11 (Ryzen 5 5500, 32 GB). The installed Legato (`app.legato.desktop`, in
  `%LOCALAPPDATA%\Legato`) is the owner's own: never stop or touch it. `pnpm dev` runs as `app.legato.desktop.devbuild`
  and the bench as `app.legato.desktop.bench`, each with its own data.
- Claude desktop runs its tools inside an MSIX package: they see a stale copy of `%APPDATA%` (`docs/development.md` ›
  Two dev libraries).
- Android tools in `C:\dev\android` (dot-source `env.ps1`; `docs/development.md` › Tools), emulator AVD `legato36`,
  headless: `emulator -avd legato36 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim`. Stop it
  after a test; its microphone stays off. Never answer Windows' firewall or any system prompt.
- `graphify` in `~/.local/bin` (the code graph, `CLAUDE.md` › graphify). Without it, read the code.
- `pnpm notices` (cargo-about) once on a new PC: a release build stops without `src-tauri/third-party-licenses.html`.
- Claude Code's own notes for this folder (`~/.claude/projects/C--dev-music-app/memory/`) hold nothing the repo lacks.
  The desktop app's scheduled task `legato-autopilot` was a one-time run (2026-11-04), now disabled.

## Traps not written elsewhere

- The bench's cold start is noisy (1.44 s, then 0.76 and 0.73 s on the same code, 2026-11-05): run
  `pnpm bench --quick --skip-build` twice more before believing a regression. The website quotes the middle one
  (`docs/performance.md`).
- `scripts/promote.mjs --dry-run` needs the release tags locally: `git fetch --tags` first.
- `git worktree remove` can stop at "Filename too long" (node_modules, target): `cmd /c rd /s /q "\\?\<full path>"`
  finishes it. A Bash `cd` into a worktree moves the session's working folder: `cd` back before removing it.
- Android builds rewrite `src-tauri/gen/android/app/tauri.properties`: restore it after. PowerShell 5.1 mangles inline
  JSON: give `--config` a file (the version of a signed APK).
- Android's WebView: wry's `onPause` paused YouTube's media behind other apps, so `MainActivity.kt` empties wry's
  `mWebView` field and keeps the page visible (its comments say why). The page's `fetch` to the `art` scheme fails on
  Android (CSP): covers go through an `<img>` and a canvas (`phoneCover`).
- Google limits this PC after about 40 anonymous searches (a 5-minute block, then one every 15 s): expect it in any
  search test, and never route around it.

## Branches

| Branch | State |
|---|---|
| `platforms` | Work goes here, local only: master plus this clean-up. |
| `master` | Every push is a Beta (and a website deploy when `site/` changed): only on the owner's word. |

The website branch (`claude/site-scroll-3d-aff654`) and its 10 GB worktree were removed on 2026-11-05: merged and
published since 2026-11-01. A fresh clone has `master` only; `git branch -vv` says what is on GitHub.

## History, one line each

- Up to 2026-10-31: the 0.1 releases, 1.0 (the redesign, `docs/design.md`), the rename to Legato (2026-10-29), then 1.1
  and the v2 plan; Stable 1.1.479.
- 2026-10-31 to 11-01: autonomous run (imports, Exportify, lyrics, local files); the new website.
- 2026-11-02: autonomous run (phone layout, phone remote, OBS overlay, Privacy's hosts); Android's first build; Beta
  1.1.603, the first with an APK.
- 2026-11-03 to 11-05: autopilot (device sync; the phone: notification, QR pairing, Keystore secrets, files, its own
  songs, background play; the visualizer's v2 looks; recap, genres, bookmarks, alarm, picture in picture, search).
- 2026-11-05 evening: the phone's updates in the app; release notes in full (Added / Fixed / Performance improved); a
  new bench on the website; Stable 1.1.681; this clean-up.
