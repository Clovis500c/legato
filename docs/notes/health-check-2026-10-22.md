# Codebase health check (phase 5, 2026-10-22)

Branch `big-update`, 39 commits ahead of `master`. Everything below was checked by reading and with scripts; `pnpm check`
(typecheck, ESLint, Vitest, Clippy `-D warnings`, cargo test) is green.

## Found and fixed

| Problem | Why it mattered | Fix |
|---|---|---|
| The dev build and the installed app used the same data folder (`dev.musicapp.desktop`). | The installed app (schema 4) wrote into a library a dev build had migrated to schema 10: the user's library was damaged on 2026-10-21 (see below). | `pnpm dev` runs as `dev.musicapp.desktop.devbuild` (own library, settings, keychain entries, WebView2 profile). `Library::open` refuses a library newer than `SCHEMA_VERSION`; the app shows an error box instead of writing into it. |
| Music Detector: cpal 0.18 reports an `Xrun` at almost every stream start; any stream error ended the clip. | "Microphone failed" at random. | Only real failures end a clip (tested on the user's PC). |
| Near-silent clips were sent to AudD. | AudD #300 ("problem creating an audio fingerprint"), a request spent for nothing. | Clips under -50 dBFS are told apart before sending; quiet ones are raised to full level; #300 has its own message. |
| Home: a button inside a button (Now playing card). | Invalid HTML (React warning), and the card always showed Play. | Open and play / pause side by side; Pause shows while playing; right-click menu added (every surface has one). |
| `src-tauri/src/lib.rs` at 1,845 lines. | "Thin shell" hard to find one's way in. | Music Detector, Live Editor + export and theme files moved to `detector.rs`, `editor.rs`, `themes.rs` (lib.rs 1,597 lines); module-private items no longer `pub`. |
| Dead component `Readout` (shared/ui/controls). | Dead code. | Removed. |
| Sync summary text untestable (lived next to code importing `app/settings`). | No test. | Pure `syncmode/merged.ts`, tested. |
| Docs: shell modules, dev data folder, theme model, detector sources. | CLAUDE.md / architecture / README out of date. | Updated. |

Also checked, nothing to fix: no `TODO` / `FIXME`, no `console.log`, `dbg!` or `println!` outside tests, no
`allow(dead_code)`; every IPC command is called by `shared/api.ts` and every `api` function is used; public Rust
functions used only by tests are test helpers (`Library::in_memory`, DSP measures).

## The library incident (2026-10-21)

- What: `%APPDATA%\dev.musicapp.desktop\library.db` reads as schema 4 with broken trees: pages of the old schema
  written over a schema-10 library. All page-1 images in its WAL (three generations) carry schema 4: the installed
  app (built from `master`, schema 4, started 23:57) kept writing from an old view of the file. Exact trigger not
  proven; the shared folder between an old and a new build is the cause that was fixed.
- Kept: raw copies of the damaged files and of the interface cache (scratchpad `evidence-*`), never modified.
- Rebuilt (not installed yet, waiting for the user's OK): the last sound backup (2026-10-20, schema 4, the format the
  installed app reads) plus what the damaged file still held from after it: 354 songs with a service id, 94 listens,
  the latest interface settings (the test theme of 2026-10-21 taken out). 12 playlists, same as the backup; imported
  ones refresh from the services at the next sync. Lost: plays not in the salvage (about 80), songs removed from the
  library since 2026-10-20 (they can come back), the lyrics cache (fetched again), Live Editor test versions.

## Still open (not fixed here)

- `lib.rs` (1,597 lines) could lose more: library, YouTube, Spotify and sharing commands are still together.
- No tests for: the Live Editor store (`editor.ts`, calls IPC), the plugin host's answers (`plugins/host.ts`), the Sync
  Mode and plugins shell modules (file handling), and the big settings screens. Their pure parts are tested.
- Rust and service error messages are English only (the interface is translated).
- Sync Mode was never run between two real PCs through a real OneDrive account; the network swap was run on one PC.
- `library.rs` (1,273 lines) mixes the schema, migrations and every query: worth splitting by area.

## Numbers

Tests: core 95, connectors 65, dsp 27, player 17, plugins 13, shield 4, shell 25, interface 34 test files (156 tests).
