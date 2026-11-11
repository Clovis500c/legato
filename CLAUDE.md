# Legato

Desktop music player (Tauri 2 + Rust + React/TS, an Android build too) that unifies Spotify, YouTube, Apple Music,
personal servers and local files. Formerly Music App (renamed 2026-10-29).

Read first: `docs/notes/handoff.md` (where the work stands), then only the sections of `docs/notes/plan-v2.md` you need
(open work; history in git). Overview `docs/architecture.md`, design `docs/design.md` (Figma file "Untitled", to be
renamed "Legato · Design", every page light and dark), playback `docs/playback.md`, dev traps `docs/development.md`.
What users read is the website, `site/` (Next.js static export on GitHub Pages, copy in `site/components/content.tsx`);
its home page runs the real `ui/` over a fake Tauri (`site/demo`: invented data, no sound, no network).

## The code map: graphify first
`graphify-out/` is the code graph (local AST, no LLM). For any question about the code, before grep or opening files:
`graphify query "<question>"`, `graphify explain "<concept>"`, `graphify path "<A>" "<B>"`. They return a scoped
subgraph, far smaller than grep output or whole files; then read only the lines they point to. `GRAPH_REPORT.md` only
for a broad architecture review. After changing code: `graphify update .`. Command not found: `py -m graphify …`.
No graph (new clone): `graphify extract . --code-only --cargo`, an empty `graphify-out/.graphify_labels.json` (`{}`),
then `graphify cluster-only .`. `docs/` isn't in it: read those directly.

## Names kept for compatibility
Identifier `app.legato.desktop` (was `dev.musicapp.desktop`: `src-tauri/src/rename.rs` moves its folders and keychain
entries at first launch), exe `legato.exe`, Run entry and new sync folders "Legato". Never rename `_musicapp._tcp`,
`MA1`, `.musicsync` files, an existing `Music App Sync` folder, the reading of `musicapp://` links. The repo is
`Clovis500c/legato` (website https://clovis500c.github.io/legato/): GitHub redirects the old `music-app` URLs and
installed versions look for updates there, so never create a repo named `music-app`.

## Non-negotiable rules
- Serverless: no backend of ours. Secrets in the OS keychain (`keyring`), local SQLite library. Sync between the user's
  PCs: a shared folder (OneDrive or any), one file per PC, or the local network with a 6-digit code; secrets travel only
  sealed, otherwise sign in again (`docs/sync-mode.md`).
- Legal playback only (Spotify Connect / official SDK, embedded YouTube player, local files, personal servers). Never
  download, record or export a platform's audio, never touch DRM. Live processing of what plays is allowed: native chain
  `crates/dsp`, YouTube in its player (`crates/shield` `live.js`, the formulas kept alike).
- Never copy code from Liner (non-commercial licence). Everything is written from scratch.
- YouTube without keys: Google sign-in in an app window (Google's own page), the session in WebView2's cookies, YouTube
  Music's and YouTube's own web APIs (InnerTube: unofficial, may break). Signed out: YouTube Music's public catalog.
  Clear non-music hidden until asked (`music_core::musicness`).
- Spotify: the user's own client ID (dev mode: Premium owner, 5 users). Without it, Connect Spotify: Exportify's page in
  a window (`crates/shield/src/exportify.js`; its key never taken out of its page), then, on the user's demand and with a
  warning (against Spotify's guidelines), the rows Spotify's own page shows; never its token, never the TOTP in its
  player. Apple Music the same way (against Apple's terms, said first): the playlists music.apple.com shows
  (`crates/shield/src/apple.js`), never its developer or user token.
- Every HTTP client the app builds takes `music_connectors::Noted` as its resolver, every window the shield hook or
  `shield::watch` (hosts talked to: Settings › Privacy). The website's privacy rows (`PRIVACY`, `SERVICES` in
  `content.tsx`) stay true when the app reaches or sends something new.
- English for code, comments, docs and commits. Every interface text goes through `shared/i18n` (`tr`, `trn` for
  counts, `msg` in tables): English source and fallback, 17 locales in `shared/i18n/locales` keyed by the English text;
  `i18n.test.ts` fails on a text missing from one or no longer used. Setting ids (`data-setting`, search labels) stay
  English.
- Nothing confidential in tracked files: the repo is public. No secrets, keys, passwords, personal data (emails,
  addresses, names, device names), nor the owner's accounts, library, machines or usage. Those stay out of git (the
  keychain, git-ignored files, Claude Code's private memory).

## Layout (crate by crate: `docs/architecture.md`; the code itself: graphify)
- `crates/core` (`music-core`): pure Rust, no Tauri. The library (rusqlite; bump `library::SCHEMA_VERSION` with each
  migration), the pure half of each shell feature.
- `crates/connectors`: injectable URLs (`with_urls`) for mockito tests. `crates/player`: Music Detector clips (memory
  only, the app's own playback paused first). `crates/dsp`, `crates/shield`: see architecture.
- `crates/plugins`: third-party plugins installed from a local folder once the user approves their permissions (checked
  in Rust, network to approved hosts only); never secrets, files or raw IPC; API version `manifest::API`, additions
  only within a version (`docs/plugins.md`).
- `src-tauri`: thin shell, the IPC commands. All logic goes in `crates/`.
- `ui/`: React 19 + Zustand + Tailwind v4: `app/` (shell), `features/<name>/`, `shared/` (api, theme, i18n, ui).
- Android (identifier `app.legato.mobile`): desktop-only shell parts behind `#[cfg(desktop)]`, phone twins in
  `src-tauri/src/mobile/`, reqwest on rustls there, plugins desktop only. Files picked or saved through
  `shared/files.ts`, never the dialog plugin's `open` / `save`.

## Code rules
- `shared/api.ts` is the only place that calls `invoke`; its types come from Rust (ts-rs, `pnpm types` →
  `shared/generated/`, committed), never written by hand.
- No network from the front end, images included: `shared/art.ts` → the `art` scheme (host allowlist, disk cache).
- Tauri commands that lock the library, read files or compute: `async fn` (a sync one runs on the window's thread and
  freezes the app).
- Only the installed app (identifier exactly `app.legato.desktop`: `identity::installed()`) updates, edits the Run entry
  or migrates folders and keychain entries; any new side effect of a release build outside the app's folders goes
  behind it. The e2e cargo feature stays off in normal builds: only there may an env var move the network (`hosts.rs`).
- Updates: Stable's `releases/latest/download/latest.json` is the URL every installed version reads: keep it. Beta =
  every green push to master (`CONTRIBUTING.md` › Releasing).
- The phone remote and the OBS overlay answer private addresses only, their secret in the keychain.
- Pages are lazy (`ui/src/app/pages.ts`); a shell file never imports a page. What waits for the first screen:
  `src-tauri/src/deferred.rs`, `ui/src/app/deferred.ts`.
- A default changed for everyone: bump `DEFAULTS_VERSION` in `theme.ts`. Modules imported by tests never import
  `app/settings` (it touches `window`): pure helpers in their own file.
- Shortcuts: one table in `ui/src/app/keys.ts`; media keys are never registered (Windows' media panel owns them).
- A diagnostics log line: our own English words + an optional detail, never a title or a name in the words.
- Themes: `BRAND_GUARD` keeps elements marked `data-brand` (Legato's name, logo, legal notices) through the user's CSS.
  Default look (`docs/design.md`): Modern / Modern Dark following Windows, the sky-blue accent for playback only.
- Long lists virtualized (`@tanstack/react-virtual`). Every surface gets a right-click menu (`features/menus.tsx`), text
  fields keep the native one. No fake buttons: an unwired feature is absent or marked "Coming soon".

## Commands
- `pnpm dev`: the app with its own data (`app.legato.desktop.devbuild`), never the installed app's library.
- `pnpm check`: types (Rust → TS) + typecheck + lint + Vitest + clippy + cargo test, green before every commit.
- `pnpm test`, `cargo test --workspace`; `pnpm e2e`: smoke test of the built app; `pnpm build`: installer; `pnpm bench`:
  start time, RAM and CPU on 10 000 songs (`app.legato.desktop.bench`, `docs/performance.md`).
- Android: `. C:\dev\android\env.ps1; pnpm tauri android build --debug --target x86_64 --apk` (emulator AVD
  `legato36`); a phone: `--target aarch64 --apk`, signed when `src-tauri/gen/android/keystore.properties` exists (never
  in git).

## Conventions
- Comments in English, caveman style: `// Feb 2026: own playlists only.`
- Rust tests in the module (`#[cfg(test)]`), front-end tests next to the code (`*.test.ts`). Never real network.
- Small commits, one tested step each, Conventional Commits. Commits and pull requests never say Claude made them: no
  `Co-Authored-By: Claude` line, no "Generated with Claude Code" (the owner's word, 2026-11-07).
- `docs/notes/plan-v2.md`: tick a line when it lands; a clean-up drops ticked lines (history in git). Rewrite
  `docs/notes/handoff.md` when a branch, a release or the next step changes. Keep both short: every start reads them.
- Check API quotas and endpoints before freezing them (they change).

## Working with the owner
- They write in French: answer in French, informally (`tu`). The French interface says `vous`.
- Nothing leaves this PC without their word in the session: no `git push`, pull request or merge into master. A push to
  master is a Beta release and can deploy the website.
- No workflows or subagents unless they ask for one themself (they drain the plan's limits). When asked: one agent at a
  time, `effort: 'high'`, the price first.
- Real accounts are theirs: never type a password, accept a consent page, or drive Spotify's or Google's sign-in; an
  import or anything that writes in bulk to a real account is run by them.
- A refusal from Google ("Sorry…" page, 429) is never routed around: no other endpoint, no CAPTCHA, no quicker retry
  (`searchpace`). No bulk real searches from a script: they count against the owner's address.
- Never touch the installed app or stop a command they started. Editing `src-tauri` or `crates/` restarts their
  `pnpm dev` and cuts what runs in it. More traps: `docs/development.md` › Running and checking the app.
