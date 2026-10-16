# Music App

Desktop app (Tauri 2 + Rust + React/TS) that unifies Spotify / YouTube / Apple Music / local libraries. Brief: `PROMPT.md`.
Reference mockups: Figma file "Bow Game / Music App", page "Music App v3 — Hi-Fi".

## Non-negotiable rules
- Serverless: no backend of ours. Secrets in the OS keychain (`keyring` crate), local SQLite library.
- Legal audio playback only (Spotify Connect / official SDK, embedded YouTube player, local files, personal servers). No audio extraction.
- Never copy code from Liner (non-commercial licence, reuse forbidden). Everything is written from scratch.
- No keys for YouTube: Google sign-in in an app window (Google's own page), session kept in WebView2's cookie store, YouTube Music's own web API (InnerTube, unofficial: user's choice 2026-10-16, may break). Spotify: user's own client ID (no keyless way; dev mode = Premium owner, 5 users max).
- English by default: UI text, docs, comments, commit messages.

## Structure
- `crates/core` (`music-core`): pure Rust, no Tauri. `Track`, `Connector` trait, `SecretStore`, matching (ISRC, then title+artist+duration), `Library` (rusqlite), `sync`, local file scan.
- `crates/connectors` (`music-connectors`): shared OAuth PKCE loopback (Spotify) + one module per service: 'youtube' (links, oEmbed), 'ytmusic' (web session), 'spotify', 'itunes', 'nearby', 'discord' (Rich Presence over the Discord app's local IPC). Injectable URLs (`with_urls`) for mockito tests.
- `crates/player` (`music-player`): native local playback (rodio/symphonia), engine thread, gapless queue. Playback choices (YouTube, local, Spotify plan): `docs/playback.md`.
- `crates/shield` (`music-shield`): ad/tracker blocker (Brave's adblock-rust) + YouTube player script.
- `src-tauri`: thin shell. IPC commands (`lib.rs`), keychain (`secrets.rs`), WebView2 hook (`shield.rs`), Google sign-in window (`ytm.rs`), Windows media panel / media keys (`media.rs`), window background before first paint (`window_bg.rs`). All logic goes in `crates/`.
- Add-ons: `features/addons/registry.ts` (list, author + verified), on/off in settings `addons`; each add-on's code in its own file there (`discord.ts` follows the player). Built in only: no third-party code is loaded.
- Keyboard shortcuts: one table in `ui/src/app/shortcuts.ts` (handler + Settings › Shortcuts list). Settings search index: `features/settings/search.ts` (labels = `data-setting` on rows).
- Player modules: `store.ts` (queue, fades, resume), `session.ts` (saved playback), `app/screen.ts` (last screen), `media.ts` (Windows panel), `still.ts` (Auto video/cover), `immersive.ts` (pre-blurred backdrop), `snap.ts` (mini player spots), `Progress.tsx` (60 fps bar).
- Settings schema changes for everyone: bump `DEFAULTS_VERSION` in `theme.ts` with the changed defaults (applied once to saved settings).
- Modules imported by tests must not import `app/settings` (touches `window` at load): keep pure helpers in their own file.
- `ui/`: React 19 + Zustand + Tailwind v4, split by feature:
  - `app/` (shell, store, navigation, settings), `features/<name>/` (library, sources, sidebar, player, add, settings…), `shared/` (typed api, format, theme, `ui/` components).
  - `shared/api.ts` = the only place that calls `invoke`. Types copied by hand from Rust: keep them in sync.
- Design tokens: `ui/src/styles.css` (`@theme`) fed by CSS variables from `shared/theme/theme.ts`.

## Commands
- `pnpm dev`: run the app (Vite + Tauri)
- `pnpm check`: typecheck + lint + Vitest + clippy + cargo test (everything must pass before a commit)
- `pnpm test` / `cargo test --workspace` separately
- `pnpm build`: installer

## Conventions
- Code comments: English, caveman style (short fragments, no articles or filler). E.g. `// Feb 2026: own playlists only.`
- Rust tests in the module (`#[cfg(test)]`), front-end tests next to the code (`*.test.ts`). Never real network in tests.
- No fake buttons: an unwired feature is absent or marked "Coming soon".
- Long lists: virtualized (`@tanstack/react-virtual`). No network access from the front end: everything goes through Rust.
  Images too: `shared/art.ts` → `art` URI scheme (`src-tauri/src/art.rs`, host allowlist + disk cache). CSP img-src has no https.
- Right-click: every surface gets a menu from `features/menus.tsx` (`onMenu(() => …)`); text fields keep the native one.
- Default look: theme `system` = Modern / Modern Dark (YouTube-style, Roboto) following Windows light/dark, accent `system` = Windows accent.
- Small commits, one tested step at a time.
- Check API quotas and endpoints before freezing them (they change; Spotify renamed `/tracks` to `/items` in February 2026).
