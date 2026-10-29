# Contributing

Music App is a personal, source-available project (see [LICENSE](LICENSE)). Issues and pull requests are welcome.
For code changes, open an issue first so we can agree on the approach. You may fork the repository only to prepare a
pull request; changing the code for any other purpose, or reusing it in another project, requires the author's written
permission. By opening a pull request, you agree that your contribution may be used and published as part of Music App
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

`pnpm dev` runs as `dev.musicapp.desktop.devbuild` (`src-tauri/tauri.dev.conf.json`): its own library, settings,
keychain entries and WebView2 profile, never the installed app's. An older app must never open a library a newer
build migrated (2026-10-21: the installed app and a dev build shared one and damaged it); `Library::open` now refuses
a library newer than `SCHEMA_VERSION`.

## Before every commit

```bash
pnpm check
```

It runs the type check, ESLint, Vitest, Clippy (warnings are errors) and the Rust tests. Everything must pass.

## Website

`site/`: Next.js exported to plain files, deployed to GitHub Pages by `.github/workflows/pages.yml` when master's
`site/` changes (Settings › Pages › Source must be GitHub Actions). Its own packages: in `site/`, `pnpm install`, then
`pnpm dev` (http://localhost:3000) or `pnpm build` (into `site/out`). The copy is in `site/components/content.tsx`; its
privacy rows replace the old `docs/privacy.md`, so change them when the app starts sending something new.

## Releasing

Updates reach users through the built-in updater (`src-tauri/src/update.rs`): it reads `latest.json` from the latest
GitHub release, downloads in the background and installs once nothing plays.

Every push to `master` that passes the `check` workflow becomes a release on its own
(`.github/workflows/release.yml`): signed installer, `latest.json`, tag `vX.Y.Z`, and notes made of the `feat`, `fix`
and `perf` commit subjects since the previous release (the app's update card shows them).

- **Version**: `MAJOR.MINOR` comes from `src-tauri/tauri.conf.json`, the patch number is the number of commits on
  `master` (`scripts/release.mjs`). The files say `1.0.0`; the release says `1.0.` plus that count. For a bigger step,
  change `MAJOR.MINOR` in `tauri.conf.json` (and `package.json`, the workspace `Cargo.toml` and the `music-*` path
  dependencies to match). 1.0: the front-end redesign (docs/design.md), after the 0.1 releases.
- **No release for a push**: put `[skip release]` in the commit's first line.
- **By hand**: Actions › release › Run workflow (releases `master` as it is).

The workflow needs the repository secret `TAURI_SIGNING_PRIVATE_KEY`, the private key made with
`pnpm tauri signer generate` (`~/.tauri/music-app.key`), plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if that key has a
password. Without it the release stops at its first step. The public key is in `tauri.conf.json`. The updater downloads
anonymously, so releases must be public.

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/music-app.key
```

## Conventions

- **Small commits**, one tested step at a time, with
  [Conventional Commits](https://www.conventionalcommits.org) messages: `feat(player): …`, `fix(library): …`,
  `docs: …`.
- **English** for code, comments, interface text and documentation.
- **Comments** are short fragments: `// Feb 2026: own playlists only.`
- **Tests** next to the code: `#[cfg(test)]` modules in Rust, `*.test.ts` files in the interface. No real network.
- **No placeholder buttons.** A feature that isn't wired is absent or marked "Coming soon".
- Follow the rules in [docs/architecture.md](docs/architecture.md): logic in `crates/`, IPC only through
  `ui/src/shared/api.ts`, no network from the interface, legal playback only.
- Everything is written from scratch: never copy code from other music apps.
