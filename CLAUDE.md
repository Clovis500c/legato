# Legato

Formerly Music App (renamed 2026-10-29). Identifier `app.legato.desktop` (was `dev.musicapp.desktop`: `src-tauri/src/rename.rs`
moves its folders and keychain entries at first launch), exe `legato.exe`, Run entry and new sync folders "Legato".
Kept for compatibility between versions and PCs: `_musicapp._tcp`, `MA1`, `.musicsync` files and an existing
`Music App Sync` folder, reading `musicapp://` links. Never rename those. The repo is `Clovis500c/legato` (renamed by the
user 2026-10-30; website https://clovis500c.github.io/legato/): GitHub redirects the old `music-app` URLs, and installed
versions look for updates there, so never create a repo named `music-app` again.

Desktop app (Tauri 2 + Rust + React/TS) that unifies Spotify / YouTube / Apple Music / local libraries. Overview: `docs/architecture.md`; open work: `docs/notes/plan-v2.md` (history in git).
Repo docs: `README.md` (short, points to the website), `CONTRIBUTING.md`, `docs/` (for developers). What users read (features,
playback, privacy, FAQ) is the website: `site/` (Next.js static export, GitHub Pages, copy in `site/components/content.tsx`).
Keep its privacy rows true when the app starts sending something new.
Design direction (v2): `docs/design.md`; mockups in the Figma file "Untitled" (to be renamed "Legato · Design"), every page in light and dark.

## Non-negotiable rules
- Serverless: no backend of ours. Secrets in the OS keychain (`keyring` crate), local SQLite library. Sync between the user's PCs (user's choice, 2026-10-21): a OneDrive (or any shared) folder, one file per PC, or the local network with a 6-digit code; secrets travel only sealed (password or code), otherwise sign in again. See `docs/sync-mode.md`.
- Legal audio playback only (Spotify Connect / official SDK, embedded YouTube player, local files, personal servers). No audio extraction: never download, record or export a platform's audio, never touch DRM. Live processing of what plays is allowed (user's choice 2026-10-20): native chain in `crates/dsp`, YouTube in its player (`crates/shield` `live.js`), see `docs/playback.md`.
- Never copy code from Liner (non-commercial licence, reuse forbidden). Everything is written from scratch.
- No keys for YouTube: Google sign-in in an app window (Google's own page), session kept in WebView2's cookie store, YouTube Music's and YouTube's own web APIs (InnerTube, unofficial: user's choices 2026-10-16 and 2026-10-20, may break). Search covers normal YouTube and YouTube Music (signed out: anonymous, YouTube Music's public catalog), clear non-music hidden until asked (`music_core::musicness`). Spotify: user's own client ID (no keyless way; dev mode = Premium owner, 5 users max).
- English for code, comments, docs and commit messages. The interface speaks the user's language (user's choice 2026-10-20): English source and fallback, French, Windows' language by default or picked in Settings › General › Language. Every UI text goes through `shared/i18n` (`tr`, `trn` for counts, `msg` in tables); `fr.ts` holds French keyed by the English text; `i18n.test.ts` fails on any text without French. Setting ids (`data-setting`, search index labels) stay English.

## Structure
- `crates/core` (`music-core`): pure Rust, no Tauri. `Track`, `Connector` trait, `SecretStore`, matching (ISRC, then title+artist+duration), `Library` (rusqlite), `sync` (services), `syncmode` (between PCs: snapshot, merge, sealing; change times and `sync_gone` in the library), local file scan.
- `crates/connectors` (`music-connectors`): shared OAuth PKCE loopback (Spotify) + one module per service: 'youtube' (links, oEmbed), 'ytmusic' (web session), 'ytweb' (normal YouTube search, search suggestions), 'spotify', 'itunes', 'nearby' (playlist share, and Sync Mode's two-way swap), 'discord' (Rich Presence over the Discord app's local IPC), 'audd' (Music Detector: AudD's few free requests a day, or the user's own token in the keychain), 'lastfm' (scrobbling with the user's own free API key + shared secret, web auth through the loopback, session key in the keychain; `src-tauri/src/lastfm.rs`, UI `features/sources/lastfm.ts`), 'lrclib' (lyrics; `music_core::lyrics` cleans titles, picks, stretches timings for slowed versions; cached in SQLite). Injectable URLs (`with_urls`) for mockito tests.
- `crates/player` (`music-player`): native local playback (rodio/symphonia), engine thread, gapless queue, Music Detector clips from the microphone or the PC's output (`mic.rs`: WASAPI loopback, user's choice 2026-10-22; memory only, the app's own playback paused first so its streams are never taken). Playback choices (YouTube, local, Spotify plan): `docs/playback.md`.
- `crates/dsp` (`music-dsp`): live audio processing, pure Rust (meter, Adaptive Sound, limiter, the Live Editor's effects `chain.rs` and speed / tempo / pitch `stretch.rs`). Its JS twin for YouTube: `crates/shield/src/live.js` (keep the formulas alike).
- `crates/shield` (`music-shield`): ad/tracker blocker (Brave's adblock-rust) + YouTube player script.
- `crates/plugins` (`music-plugins`): third-party plugin runtime (QuickJS per plugin, memory and time limits), manifest and permissions, network gateway. Plugin API version: `manifest::API`; additions only within a version.
- `src-tauri`: thin shell. IPC commands (`lib.rs`; feature ones in `detector.rs` Music Detector, `editor.rs` Live Editor + export, `themes.rs` theme pictures and files, `folders.rs` watched local folders), keychain (`secrets.rs`), WebView2 hook (`shield.rs`), Google sign-in window (`ytm.rs`), watch-page player for videos that can't be embedded (`ytwatch.rs`), Windows media panel / media keys (`media.rs`), window background before first paint (`window_bg.rs`), background updates (`update.rs`, checked at every launch, installed between two songs or at a quiet moment by `ui/src/features/update/updates.ts`; release = every green push to master, auto version, see CONTRIBUTING), tray mode (`background.rs`: close = hide, low-resource webview, suspend; Quit is the only exit), global shortcuts (`hotkeys.rs`), voice search (`speech.rs`: WinRT `SpeechRecognizer`, needs Windows' online speech recognition; WebView2 has no Web Speech), Sync Mode shell (`syncmode.rs`: folder, keychain key, minute timer, network; snapshots read WebView2 cookies, so async commands only). All logic goes in `crates/`.
- Add-ons: `features/addons/registry.ts` (list, author + verified), on/off in settings `addons`; each add-on's code in its own file there (`discord.ts` follows the player). Third-party plugins (user's choice, 2026-10-21): local folders installed from Add-ons after the user approves their permissions, each in its own QuickJS runtime (`crates/plugins`: manifest, permissions checked in Rust, network gateway to approved hosts only; shell `src-tauri/src/plugins.rs`; interface side `features/plugins/`: answers player / menu / panel / style calls, panel = data drawn by the app). Never secrets, files or raw IPC. Author docs: `docs/plugins.md`, example `examples/plugins/sleep-timer`.
- Keyboard shortcuts: one table of actions with default keys in `ui/src/app/keys.ts` (pure: labels, combos from physical keys, conflicts), their handlers in `ui/src/app/shortcuts.ts`; user bindings in settings `shortcuts`, edited in Settings › Shortcuts. "Everywhere" bindings are OS hotkeys registered by Rust (`src-tauri/src/hotkeys.rs`, work in the background / tray); media keys are never registered (SMTC owns them). Settings search index: `features/settings/search.ts` (labels = `data-setting` on rows).
- Live Editor: `features/editor/` (`editor.ts` store: settings playing now, per-song versions and presets in SQLite `edits`; `EditorPanel.tsx` beside the cover), pure helpers in `player/effects.ts` (neutral values, built-in presets, song keys). Export of a modified copy: local files only (`crates/player` `export.rs`, WAV).
- Player modules: `store.ts` (queue, fades, resume), `session.ts` (saved playback), `app/screen.ts` (last screen), `media.ts` (Windows panel), `still.ts` (Auto video/cover), `live.ts` + `liveSync.ts` (live processing settings out, levels in), `pulse.ts` (moving cover), `immersive.ts` (pre-blurred backdrop), `snap.ts` (floating mini player spots), `SidePanel.tsx` (right panel: Up next or lyrics, the mini player on top, the default place), `SidebarPlayer.tsx` (mini player docked in the sidebar, a choice), `Progress.tsx` (60 fps bar).
- Settings schema changes for everyone: bump `DEFAULTS_VERSION` in `theme.ts` with the changed defaults (applied once to saved settings).
- Modules imported by tests must not import `app/settings` (touches `window` at load): keep pure helpers in their own file.
- `ui/`: React 19 + Zustand + Tailwind v4, split by feature:
  - `app/` (shell, store, navigation, settings), `features/<name>/` (library, sources, sidebar, player, add, settings…), `shared/` (typed api, format, theme, `ui/` components).
  - `shared/api.ts` = the only place that calls `invoke`. Types copied by hand from Rust: keep them in sync.
- Design tokens: `ui/src/styles.css` (`@theme`) fed by CSS variables from `shared/theme/theme.ts`. Themes (Settings › Appearance, `features/settings/ThemeStudio.tsx`): palette, font, corners (Tailwind radius vars), glow, background picture (covers folder `bg-<hash>`, served by the `art` scheme, surfaces see-through over it), a look (appearance settings applied on pick), own CSS (`shared/css.ts` cleaned; `BRAND_GUARD` keeps elements marked `data-brand`: Legato's name, logo, legal notices). `.theme` files carry the picture (`music_core::themefile`).

## Commands
- `pnpm dev`: run the app (Vite + Tauri), with its own data folder (`tauri.dev.conf.json` identifier): never the installed app's library. Bump `library::SCHEMA_VERSION` with each migration.
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
- Default look (v2, `docs/design.md`): theme `system` = Modern / Modern Dark (Roboto, layered panels) following Windows light/dark, accent = the theme's sky blue, for playback only (play button, playing mark); everything else ink and greys.
- Running to-do of the user's requests: `docs/notes/plan-v2.md` (tick lines as they land, so a new session can resume).
- Tauri commands that lock the library, read files or compute: `async fn` (a sync command runs on the window's thread; a
  wait there freezes the whole app: Windows' AppHang on v0.1.217, 2026-10-23).
- Small commits, one tested step at a time.
- Check API quotas and endpoints before freezing them (they change; Spotify renamed `/tracks` to `/items` in February 2026).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Code only (local AST: no LLM, no subagents), so `docs/` isn't in it: read those directly. No graph yet (new clone):
  `graphify extract . --code-only --cargo`, an empty `graphify-out/.graphify_labels.json` (`{}`: communities named
  after their hub, no LLM), then `graphify cluster-only .`.
