# Workflow

Today (2026-10-30): `check.yml` on Windows, macOS, Linux (crates only), 5-11 min; every green push to master runs
`release.yml` (13-18 min: signed installer, `latest.json`), so 369 releases so far and every user gets every push;
`pages.yml` deploys `site/`. No end-to-end tests (55 front-end test files, ~256 Rust tests). IPC types copied by hand
into `ui/src/shared/api.ts` (735 lines). `src-tauri/src/lib.rs` 2068 lines, `crates/core/src/library.rs` 1852.

## Release channels: Beta and Stable

- **Sees**: Settings › General › Updates: Stable (default) or Beta (every change first). About shows the channel.
- **How**: `release.yml` keeps releasing every green push, as a prerelease, with `latest-beta.json`. Stable =
  promoting a tested beta: a manual workflow (`workflow_dispatch` with the version) that copies the release to a
  normal one and writes `latest.json`. `src-tauri/src/update.rs` picks the endpoint by setting. Switching Beta →
  Stable waits for the next stable newer than the installed one (never downgrades).
- **Rules**: installed versions read `latest.json` from the repo's releases (CLAUDE.md: the repo name matters): keep
  that file's URL for Stable so old versions keep updating.
- **Effort**: S-M. **Risk**: the endpoint for old installs (must stay Stable's).
- **Done when**: a push reaches a Beta PC and not a Stable PC; a promote run updates the Stable PC.

## Release notes in the user's words

- **Sees**: after an update, a "What's new" card with 3-5 lines in the user's language; the full list on the release
  page.
- **How**: commit subjects are conventional (`feat(x):`, `fix(x):`): `scripts/release.mjs` groups them since the last
  stable; a `notes/` file per version can override with hand-written lines (and their French). The app reads the
  notes from the update's metadata (`latest.json` has a `notes` field).
- **Effort**: S-M. **Done when**: a Stable update shows its notes once, in French on a French PC.

## Generated IPC types

- **Sees** (developers): no more hand-copied types; a type change in Rust breaks the TypeScript build at once.
- **How**: `specta` + `tauri-specta` (generates typed command bindings and types into a `bindings.ts`), or `ts-rs`
  (types only, `#[derive(TS)]`). tauri-specta also types `invoke` calls: `shared/api.ts` becomes thin wrappers.
  Generation runs in `cargo test` (a test writes the file; CI fails when git sees a diff).
- **Rules**: `shared/api.ts` stays the only caller of `invoke`.
- **Effort**: M (many commands: 150+ in `generate_handler!`). Do it type by type: derive first, then switch callers.
- **Done when**: no struct in `api.ts` written by hand; CI's diff check in place.

## Split the big files

- **How**: `src-tauri/src/lib.rs` into feature modules like `detector.rs` / `editor.rs` already are: `library_cmds.rs`
  (library, playlists, history), `player_cmds.rs`, `accounts.rs` (connect, sign-ins), `sources.rs` (search, imports),
  `settings_cmds.rs`; `lib.rs` keeps `AppState`, setup and the handler list. `crates/core/src/library.rs`: one file
  per table group (tracks, playlists, history, edits) under `library/`. No behaviour change, one commit per move.
- **Effort**: M. **Done when**: no file above ~800 lines; `pnpm check` green after each move; graphify updated.

## End-to-end smoke test

- **How**: `tauri-driver` (WebDriver for Tauri on Windows, uses Edge WebDriver matching WebView2) with WebdriverIO, in
  `e2e/`. Test build with the dev identifier and a demo data folder (the demo library from the website shots).
  Network: connectors already take injectable URLs (`with_urls`): an env var points them to a local mock server
  started by the test. Steps: welcome screen, add the demo folder, play a song, check position moves, open Search
  (mocked YouTube), add to a playlist, quit; screenshots on failure as CI artifacts.
- **Effort**: M. **Risk**: WebView2 / Edge driver versions on CI (pin with `msedgedriver` matching).
- **Done when**: runs in `check.yml` on Windows under 5 min, catches a deliberately broken play button.

## Scripted live checklist

- **How**: a dev-only page (`ui/dev/` harness or a hidden Settings page in dev builds) listing the "Check live" items;
  each item has an "Run" that drives the app (play this, fade that) and asks the user Yes / No for what only ears or
  eyes can judge; results saved to `docs/notes/checks-YYYY-MM-DD.md`.
- **Effort**: M. **Done when**: the current "Check live" list runs in 15 minutes.

## Local diagnostics log

- **Sees**: Settings › About › Copy diagnostics: version, Windows build, WebView2 version, settings that matter, the
  last errors; pasted into a bug report.
- **How**: `tracing` + a rotating file appender (5 × 1 MB) in the app data folder; front-end errors forwarded through
  one IPC command; no song titles or account names unless "Include details" is ticked.
- **Rules**: nothing sent, ever (the user copies it).
- **Effort**: S-M. **Done when**: a forced error shows in the copied text; files never exceed 5 MB.

## Faster CI

- **How**: macOS job only when `crates/`, `src-tauri/`, `Cargo.*` change (`paths` filter, or a job-level `if` from
  `dorny/paths-filter`); `cargo nextest` (parallel, faster on many test binaries); `sccache` with the GitHub Actions
  cache backend; front-end-only pushes skip Rust jobs; release job reuses check's build cache.
- **Effort**: S. **Done when**: a front-end-only push finishes check in under 4 min.

## graphify hook

- **How**: the user runs `graphify hook install` (persistence the auto mode refused), then drops the `.gitattributes`
  line it adds (the graph isn't tracked).
- **Effort**: S (the user's step).

## Lighter CLAUDE.md

- **How**: CLAUDE.md keeps the rules, commands and pointers; the long Structure paragraphs move to
  `docs/architecture.md` (read when needed). Target < 6 kB.
- **Effort**: S. **Risk**: losing a rule (diff reviewed line by line).

## Project skills for Claude Code

- **How**: `.claude/skills/`: `release-check` (what to verify before a Stable promote), `add-setting` (schema in
  `theme.ts`, `DEFAULTS_VERSION`, search index row, `data-setting`, i18n French, test), `add-connector` (module,
  `with_urls`, mockito tests, privacy row on the website, `art` allowlist), `add-ipc-command` (async rules, api.ts,
  types). Each a short checklist from CLAUDE.md's conventions.
- **Effort**: S. **Done when**: a session adding a setting follows the skill end to end.

## Issue templates and public roadmap

- **How**: `.github/ISSUE_TEMPLATE/bug.yml` (version, steps, Copy diagnostics), `idea.yml`; website › Roadmap page
  generated from this plan's milestone table (script reads `plan-v2.md`).
- **Effort**: S.
