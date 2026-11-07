# Handoff

Where the work stands, for a session or an account with no history here. Read this first, then `CLAUDE.md` (rules, map
of the code), then only the parts of [plan-v2.md](plan-v2.md) you need (open work, by section). Rewrite this file when a
branch, a release or the next step changes. Its older versions (the run logs of 2026-10-31 to 2026-11-06) are in git:
`git log -p -- docs/notes/handoff.md`; each commit message says what it did and what wasn't tried for real.

Written 2026-11-05, late evening, after a clean-up (the owner's ask: another account with none of this context should
be able to take the project over). Updated 2026-11-06, evening, from the owner's other PC (› On the other PC), and
2026-11-07, about 11:00 (Paris): the end of an autonomous run, stopped near the week's limit (› Autonomous run of
2026-11-07).

## Where things stand

- **Released:** Stable is **1.1.681** (`0c3561a`, 2026-11-05): the Windows installer, `latest.json` and the Android APK
  (`Legato_1.1.681_android-arm64.apk`). Betas since, each on the owner's word: 1.1.742 (the 2026-11-06 run: U1, U2,
  rooms, servers, the phone fixes, line 2), 1.1.745 (the phone-1 review: Back, a YouTube song without internet),
  1.1.751 (Against Liner 3 to 5, the round covers), then their PC tries' fixes (the animated playing mark, Music App
  removed by the next update, the list's click and sideways scrollbar), then (2026-11-07, night) Against Liner 7 (the
  recap's profile card), 8 (there already), 9 (doubtful matches checked at an import's end), 10 (Next starts faster:
  857 to 709 ms median, measured in pnpm dev) and Now Playing's lyrics on the backdrop; then **1.1.783** (2026-11-07,
  late morning, on the owner's word "Release en beta"): the autonomous run's commits (› Autonomous run of 2026-11-07),
  `pnpm check` and `pnpm e2e` green before the push; then **1.1.785** (12:43, their word): the APK built in its own job
  beside Windows (`release.yml`), the website opening in the visitor's language. 1.1.784 was a test, cancelled
  before it published anything. Then **1.1.795** (15:46, their word): Dependabot's four PRs merged and fitted, the
  minimatch alert fixed (plan-v2 › Workflow › The security bots); GitHub closed the PRs and the alert.
- **GitHub's master** = 1.1.795 (`1119dcd`); **platforms** adds this file's update (docs, not pushed). The local
  `master` ref lags (pushes go `platforms:master`): `git log origin/master..platforms` shows what isn't on GitHub. The
  website, https://clovis500c.github.io/legato/, is deployed from master: the phone story, 18 languages, the visitor's
  own language (checked online). No stash, no other branch or worktree on this PC.
- **Untracked:** `docs/notes/report-*.md`, the owner's reports in French (what each autonomous run did, what to try),
  and the old transcript `2026-10-30-001238-…txt` at the root. Never commit them; read the reports for context.
- **Never tried for real** (built and unit-tested, seen in the demo or on the emulator only): plan-v2 › Check live in
  the real app. The owner tries them; what they find comes first.

## Autonomous run of 2026-11-07 (ended at 86 % of the week)

The owner's ask (2026-11-07, about 05:05): go on through plan-v2's open lines alone, hardest first, managing the
limits; they can't answer, so no question: a choice that's the project's is "Decided alone (date)" in its plan line,
easy to undo. Inline (no workflow or subagent: `CLAUDE.md`'s rule), one tested local commit per step on `platforms`,
never pushed.

- Pacing: limits first at each resume (the 5-hour window at 80 % or more: wait for its reset; the week at 90 %: the run
  ends, about 10 % kept for the owner). After each commit, from 85 % of the window: stop cleanly (nothing red
  committed, plan-v2 ticked, this file), then a one-shot CronCreate (session only) at the reset + 7 min with the same
  prompt (in this session's transcript; another session writes its own of the same shape).
- The order given: 18 Linux (only if it builds here), 19 macOS, the website's phone story, Against Liner 13, 14, 15,
  16's local parts, 12, 11, 6, then the rest of the plan (milestone 3 Platforms, Features › High, then Medium), hardest
  first.
- Done: 18 and 19 not here (no WSL on this PC, installing it is a system change, the owner's; macOS needs a Mac or CI;
  noted on their lines). The website's story on a phone (`2aa7c26`). 13: playlists there at once, each song looked up
  as it comes up to play (`031352e`). 14: a music server's own lyrics, the lyrics picker with a match % (`1f4ebf9`).
  15 set aside: SoundCloud's API terms cover its widget's list (`ec9ff17`; its line says what's possible instead).
  16: the website in all 18 of the app's languages (`2301a4a` the structure and French, then `5d06236` to `bc6f0f3`,
  each checked from 375 to 1440 px; CONTRIBUTING says how to keep them alike), winget manifests for Stable 1.1.681
  (`packaging/`, validated, not submitted; no Scoop manifest, decided alone, its README says why), three more README
  screens. 16's last part, Discussions, is outward: the owner's.
- Stopped at 11:00 with the week at 86 %: 12, 11 and 6 each need more than the 4 % left before 90 %, and half a feature
  is worse than none. No wake-up scheduled; the week resets 2026-11-12, 16:00 (Paris).
- Next, in the given order: 12 (a moving cover background, our own WebGL shader, under 3 % CPU), 11 (share links: a
  static page on the website reads the playlist from the link's fragment; the code is `music_core::share`'s, zlib +
  base64url, `DecompressionStream('deflate')` reads it in a browser), 6 (snap layouts), then the rest of the plan
  (milestone 3 Platforms, Features › High, then Medium), hardest first.
- Not tried for real: plan-v2 › Check live, its last item (the 2026-11-07 work); the 17 languages never read by a
  native speaker; the README's screens and the new pages not looked at on GitHub after the push.
- Pushed afterwards on the owner's word: Beta 1.1.783.

## How to continue

1. The owner writes in French: answer in French with « tu » (the French interface says « vous »). Take their latest ask,
   or ask what they want. Their standing rules are in `CLAUDE.md` › Working with the owner; read them before anything
   else: no push without their word, no subagents or workflows unless they ask, real accounts are theirs, a Google
   refusal is never routed around.
2. If they only say "carry on": fixes from their tries first (plan-v2 › Check live), then the 2026-11-07 run's next
   steps (above), then plan-v2's other open lines that need no account, smallest first:
   - Against Liner: 12 (a moving cover background), 11 (share links), 6 (snap layouts); 15 set aside, 16's last part
     (Discussions) outward, 18 and 19 need a Linux machine and a Mac (or CI).
   - Features, sorted › High: same loudness across sources (needs an ear), the accessibility pass, personal servers
     (Subsonic, Jellyfin and Plex built 2026-11-06, untried on a real server; their own search, Plex JWT and transcoder
     as plan lines), macOS and Linux builds.
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

They did five (2026-10-31, 11-02, 11-03 to 11-05, 11-05 to 11-06, 11-07; their reports are the untracked
`report-*.md`). The rules that worked, on top of `CLAUDE.md`:

- Never a question, never a wait. A choice that's the project's: the option easiest to undo, written in its plan line
  ("decided alone (date): what, why"). What only the owner can do goes to plan-v2 › Waiting on the user; then the next
  step. A line that needs their eye or taste: built behind a setting that's off, so they judge it later.
- Each step as in "How to continue" above; no push, PR, merge, release or website deploy.
- Usage: `get_usage` after each step. From 90 % of the week no new step: finish the one in hand, then the end (95 % at
  the latest). After a 5-hour limit, resume: a one-shot CronCreate at the reset + 7 min (it ends with the session).
- With workflows (only when they ask, as on 2026-11-05): one per plan line, a builder then a reviewer that tries to
  break its commits; no new one above about 40 % of the 5-hour window (their word, 2026-11-06). The script's shape is
  in this file's version of 2026-11-06 (`git log -p -- docs/notes/handoff.md`).
- The end: a report in French (`docs/notes/report-<date>.md`, untracked: done, to try, waiting for the owner), this file
  rewritten, the wake-up deleted, the report sent to the owner.

## Waiting on the owner

- Their tries of the Betas: plan-v2 › Check live in the real app, its last items first.
- winget: microsoft/winget-pkgs#474341, opened from their account on their word (2026-11-07). Microsoft's CLA bot
  asks them for a one-line reply there (agreeing is theirs), then its checks and a moderator; a new Stable needs a new
  manifest (`packaging/README.md`).
- 18 and 19: built by GitHub's Actions (their word, 2026-11-07); local Linux tries once they set up WSL or a VM
  themself (a system change).
- The phone: 1.1.681's APK installed by hand once (older APKs have no updater); later APKs come through the app
  (Settings › About). Background play behind other apps, the notification's controls and the phone ↔ PC sync were only
  tried on the emulator.
- The iPhone build: their signing choice (Apple Developer Program, or an unsigned .ipa). The Play Store or not (the
  APK's `REQUEST_INSTALL_PACKAGES` would have to go).
- A backup of the signing keys (below).
- Outside Legato, seen on the owner's PC (2026-11-06): a startup entry "Display Calibration" running `javaw -jar` on a
  .DLL in `AppData\Local\Microsoft\GameDVR`. Looks like malware; told them, untouched.
- plan-v2 › Waiting on the user (Discord's app name, a trademark search, Figma, SponsorBlock's default…) and › Not done
  yet.

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
- `graphify` in `~/.local/bin` (the code graph, `CLAUDE.md` › graphify; `py -m graphify update .` when the command
  isn't found). Without it, read the code. No WSL, no `python3` (`py`).
- `pnpm notices` (cargo-about) once on a new PC: a release build stops without `src-tauri/third-party-licenses.html`.
- Claude Code's own notes for this folder (`~/.claude/projects/C--dev-music-app/memory/`) hold nothing the repo lacks.
  The desktop app's scheduled task `legato-autopilot` was a one-time run (2026-11-04), now disabled.

## On the other PC

The owner's second PC (2026-11-06, evening), also `C:\dev\music-app` on Windows 11: Node 26, pnpm 11, cargo 1.99, `gh`
signed in as `Clovis500c`; `pnpm check` green there. What it lacks:

- Android: the SDK is in `%LOCALAPPDATA%\Android\Sdk` (NDK 27.1, platforms 36 and 37.0, build-tools 35 and 36, the
  emulator), JDK 21 as `JAVA_HOME` (the `java` on PATH is 1.8), no `C:\dev\android\env.ps1`. An APK needs the Rust
  target (`rustup target add x86_64-linux-android`, `aarch64-linux-android` for a phone) and a first Gradle run (it
  downloads Gradle and the Android libraries); the emulator needs its image (the AVD `Pixel_9` points at
  `system-images;android-37.1;google_apis_playstore_ps16k;x86_64`, not installed). Each download: the owner's word.
- No signing keys (no `~/.tauri/music-app.key`, no Android keystore): releases and signed APKs stay on the first PC
  (or GitHub's Actions).
- No graphify (read the code) and none of the owner's `report-*.md`.
- Old local branches and worktrees from October, left as they were (removing them is the owner's call): `v2`,
  `claude/mixes-algo` and `claude/mystifying-greider-d4618d` merged; `backup/*` and the translation branches
  (`claude/cranky-bartik-ed5090`, `claude/gallant-napier-5b5e7f`, `claude/nervous-engelbart-588c97`) look unmerged
  after the author rewrite, their languages are on master; a stash (`local docs`, already upstream).

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
- The website: `app/[lang]`'s static export needs at least one language besides English in `COPIES`; `npx tsc -p site`
  shows stale `.next/types` errors until `npx next build` rewrites them. Its dev server can keep a stale error after
  routes move: restart it.

## Branches

| Branch | State |
|---|---|
| `platforms` | Work goes here: GitHub's master (Beta 1.1.795) plus docs. |
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
- 2026-11-05 to 11-06: autonomous run with workflows (U1 the phone's interface, U2 glow and simplicity, listening rooms
  on the local network, personal servers), pushed at 92 % of the window; then, on the other PC, the phone-1 review,
  Against Liner 3 to 5, the round covers; Betas 1.1.742 to 1.1.751.
- 2026-11-07: Against Liner 7 to 10 and the lyrics' look, a Beta (night); an autonomous run (morning: the website's
  phone story and 18 languages, imports in seconds, server lyrics and the picker's %, winget; › above), Beta 1.1.783;
  the APK beside Windows and the site in the visitor's language, Beta 1.1.785.
