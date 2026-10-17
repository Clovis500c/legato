# Contributing

Music App is a personal, source-available project (see [LICENSE](LICENSE)). Bug reports and ideas are welcome as
issues. For code changes, open an issue first so we can agree on the approach.

## Setup

Windows 10 or 11, [Rust](https://rustup.rs) stable, Node.js 22 or later, [pnpm](https://pnpm.io).

```bash
pnpm install
```

```bash
pnpm dev
```

## Before every commit

```bash
pnpm check
```

It runs the type check, ESLint, Vitest, Clippy (warnings are errors) and the Rust tests. Everything must pass.

## Releasing

Updates reach users through the built-in updater (`src-tauri/src/update.rs`): it reads `latest.json` from the latest
GitHub release, downloads in the background and installs once nothing plays.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, then push a tag `vX.Y.Z`: `.github/workflows/release.yml` builds the signed installer and publishes the
   release with `latest.json`.

The workflow needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the private key made with
`pnpm tauri signer generate`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public key is in `tauri.conf.json`. The
updater downloads anonymously, so releases must be public.

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
