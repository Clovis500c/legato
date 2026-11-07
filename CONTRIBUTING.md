# Contributing

Legato is a personal, source-available project (see [LICENSE](LICENSE)). Issues and pull requests are welcome; a bug
report asks for Settings › About › Copy diagnostics (`.github/ISSUE_TEMPLATE`).
For code changes, open an issue first so we can agree on the approach. You may fork the repository only to prepare a
pull request; changing the code for any other purpose, or reusing it in another project, requires the author's written
permission. By opening a pull request, you agree that your contribution may be used and published as part of Legato
under its license.

## Setup

Windows 10 or 11, [Rust](https://rustup.rs) stable, Node.js 22 or later, [pnpm](https://pnpm.io). Linux and macOS
packages, signing in to YouTube Music and Spotify while developing, and where secrets and data live:
[docs/development.md](docs/development.md).

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` runs as `app.legato.desktop.devbuild` (`src-tauri/tauri.dev.conf.json`): its own library, settings,
keychain entries and WebView2 profile, never the installed app's. An older app must never open a library a newer
build migrated (2026-10-21: the installed app and a dev build shared one and damaged it); `Library::open` now refuses
a library newer than `SCHEMA_VERSION`.

## Before every commit

```bash
pnpm check
```

It writes the interface's types from the Rust ones (`pnpm types`: commit what changes in `ui/src/shared/generated`),
then runs the type check, ESLint, Vitest, Clippy (warnings are errors) and the Rust tests. Everything must pass.

`pnpm e2e` is the smoke test of the built app (Windows): launch, welcome, scan a demo folder, play, search against a
mock, quit. About 15 seconds once built; CI runs it in its own job. Run it when a change touches playback, the welcome,
search, the library scan or how the app starts and ends. [docs/development.md](docs/development.md) has the details.

## Website

`site/`: Next.js exported to plain files, deployed to GitHub Pages by `.github/workflows/pages.yml` when master's
`site/` or `ui/` changes (Settings › Pages › Source: GitHub Actions, on since 2026-10-29). Packages: `pnpm install` at the
root and in `site/`, then, in `site/`, `pnpm dev` (http://localhost:3000) or `pnpm build` (into `site/out`). The copy is in
`site/components/content.tsx`; its privacy rows replace the old `docs/privacy.md`, so change them when the app starts
sending something new.

The site speaks the app's 18 languages: English at the root, every other one at `/<code>/` from its own
`site/components/i18n/<code>.ts` (a `Copy`, listed in `copies.ts`). A line changed or added in English changes in each
of them, with the app's own words for its settings and pages (`ui/src/shared/i18n/locales`); the `PRIVACY` table (what
leaves the PC, where to) stays English everywhere, the one reference. The headline's size comes from its longest line (`Hero.tsx` `fit`): look at a new headline from
375 to 1440 px, three lines each, the header on one line.

The window on the home page is the app: `site/demo` starts `ui/` as it is, over a fake Tauri (`tauri.ts`), invented data
and answers (`data.ts`), and screens picked by the page's scroll (`scenes.ts`). `pnpm build` makes it into `public/demo`,
so `pnpm dev` shows the pictures until a build has run; `demo` in `.claude/launch.json` serves it alone with hot reload
(port 5190: the phone layout is checked there at 375 × 812). A screen that needs a new command at load may need an answer in
`data.ts`; what needs an account, the network or the PC goes in its refused list. `pnpm typecheck` at the root covers it.

`site/public/shots` holds those pictures: reduced motion, and the window or the phone before the demo is up (or instead
of it: Save-Data, a failed demo, a phone under 20 frames a second). Taken from the built demo,
`demo/index.html?shot=<scene>&p=<0 to 1>&theme=modern` or `modern-dark` (add `&full` for Now Playing), at 1024×648 so a
phone can read them, `library` at 1360×860 to match the window. The phone's (`<scene>-phone-light` / `-dark`, under
1000 px) at 375×812, saved 600 px wide: `?theme=…` alone, then the scene posted as the page would
(`postMessage({ legato: 'scene', name, p })`), so it plays in the phone layout (the player's opens Now Playing on Up
next). Visualizer and themes pick their own theme: one picture for both.

## Releasing

Updates reach users through the built-in updater (`src-tauri/src/update.rs`): it reads a `latest.json` from GitHub
releases, downloads in the background and installs once nothing plays. Two channels, picked in Settings › General ›
Updates (the `updateChannel` setting, kept per PC, not synced):

- **Beta**: every push to `master` that passes the `check` workflow is released on its own
  (`.github/workflows/release.yml`) as a *prerelease*: signed installer, `latest.json`, tag `vX.Y.Z`, and notes made of
  the `feat`, `fix` and `perf` commit subjects since the previous release, every one of them, under Added, Fixed and
  Performance improved (`scripts/notes.mjs`; the app's update card shows them). The
  workflow then copies that `latest.json` to the rolling release named `beta` (made on the first run), which Beta PCs
  read: `releases/download/beta/latest.json`.
- **Stable** (the default): a beta that was tried, promoted by hand. Actions › promote › Run workflow
  (`.github/workflows/promote.yml`, `scripts/promote.mjs`) with a version like `1.0.375`, or empty for the newest beta.
  It refuses a version that is not newer than the current Stable, writes the notes of everything since the previous
  Stable (`feat` / `fix` / `perf`) into that release's `latest.json` and page, then makes it a normal release, marked
  Latest. Stable PCs read `releases/latest/download/latest.json` and GitHub's "latest" skips prereleases, so a push
  never reaches them. **That URL is the one every installed version has always read (`tauri.conf.json`): keep it.**
- Back from Beta to Stable the app never downgrades: it waits for a Stable newer than the version it runs.
- **Phones** follow Beta: each Beta's APK is what the Android app offers (Settings › About, a toast), downloaded when
  the user taps Update and installed by Android's installer. Stable carries no APK yet.

- **Version**: `MAJOR.MINOR` comes from `src-tauri/tauri.conf.json`, the patch number is the number of commits on
  `master` (`scripts/release.mjs`). The files say `1.1.0`; the release says `1.1.` plus that count. For a bigger step,
  change `MAJOR.MINOR` in `tauri.conf.json` (and `package.json`, the workspace `Cargo.toml` and the `music-*` path
  dependencies to match). 1.0: the front-end redesign (docs/design.md), after the 0.1 releases. 1.1: the first Stable of the v2 plan (2026-10-31).
- **No release for a push**: put `[skip release]` in the commit's first line (no beta either).
- **By hand**: Actions › release › Run workflow (releases `master` as it is, as a beta).
- **Try a promote**: `node scripts/promote.mjs --dry-run` prints which version would become Stable and its notes; it
  changes nothing (needs the `gh` CLI signed in).

The workflow needs the repository secret `TAURI_SIGNING_PRIVATE_KEY`, the private key made with
`pnpm tauri signer generate` (`~/.tauri/music-app.key`), plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if that key has a
password. Without it the release stops at its first step. The public key is in `tauri.conf.json`. The updater downloads
anonymously, so releases must be public.

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/music-app.key
```

The APK builds in its own job (`android`), beside the Windows installer, and a last small job (`apk`) attaches it to
the release once both are done. It signs with the repository secrets `ANDROID_KEYSTORE` (the release keystore, a `.jks` in base64) and
`ANDROID_KEYSTORE_PASSWORD` (store and key), alias `legato`; without them the Windows Beta still goes out, with no APK.
A local release APK is signed when `src-tauri/gen/android/keystore.properties` exists (git-ignored: `storeFile`,
`password`, `keyAlias`). Secrets can't be read back from GitHub, so the files are the only copies: the updater key
lost, installed PCs can't take a later update; the keystore lost, phones must uninstall to take a later APK. Keep a
backup of both.

## Conventions

- **Small commits**, one tested step at a time, with
  [Conventional Commits](https://www.conventionalcommits.org) messages: `feat(player): …`, `fix(library): …`,
  `docs: …`.
- **English** for code, comments and documentation. Interface text is written in English and goes through `shared/i18n`,
  with its translation in every language.
- **Comments** are short fragments: `// Feb 2026: own playlists only.`
- **Tests** next to the code: `#[cfg(test)]` modules in Rust, `*.test.ts` files in the interface. No real network.
- **No placeholder buttons.** A feature that isn't wired is absent or marked "Coming soon".
- Follow the rules in [docs/architecture.md](docs/architecture.md): logic in `crates/`, IPC only through
  `ui/src/shared/api.ts`, no network from the interface, legal playback only.
- Everything is written from scratch: never copy code from other music apps.
