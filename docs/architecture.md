# Architecture

Legato (formerly Music App) is a Tauri 2 desktop app: a Rust core does the work, and a React interface draws it in a WebView2 window.
There is no backend: the library, settings and tokens stay on the user's PC.

```
ui/                     React interface, one folder per feature
  shared/api.ts         the only caller of Rust (Tauri invoke)
        │  IPC commands, events, `art` image scheme
src-tauri/              thin shell: commands, keychain, WebView2 hook, media panel, tray, Discord
  ├─ crates/core        library, matching, SQLite, sync, mixes, sharing
  ├─ crates/connectors  YouTube Music, Spotify, Apple catalog, Discord, nearby sharing, image cache
  ├─ crates/player      audio engine thread, gapless queue
  └─ crates/shield      ad and tracker blocking
```

## Crates

| Crate | Role |
|---|---|
| `music-core` | Track model, matching (ISRC, then title + artist + duration), SQLite library with versioned migrations, sync, Sync Mode between PCs (snapshot, merge, sealing), local file scan (tags read on a few threads, covers skipped, a rescan reads only files whose size or date changed; missing tags filled from the file name, "01 - Artist - Title", so untagged files link to the same song from other services), listening history and mixes, share codes, search merging and the music / not music classifier. No Tauri, no network. |
| `music-connectors` | One module per service. Shared OAuth PKCE loopback (Spotify), YouTube Music web session, normal YouTube search, iTunes catalog and Apple Music album / playlist links, Deezer playlist / album links (public API), LRCLIB lyrics, AudD song recognition (user's token), Discord IPC, nearby sharing and Sync Mode's network swap (mDNS + SPAKE2), image cache. One HTTP client for all of them (`connectors::http()`: connections and TLS sessions reused; a client per call cost a new connection per request). Base URLs are injectable for tests. |
| `music-player` | Native playback of local files and previews (rodio, symphonia) on its own thread, with a gapless queue, through the live processing chain. Live Editor export of local files (WAV). Music Detector clips from the microphone or what the PC plays (WASAPI loopback), memory only. |
| `music-dsp` | Live audio processing, pure Rust: biquads, BS.1770 loudness meter, Adaptive Sound gain, limiter, the Live Editor's effects (EQ, compressor, width, echo, reverb, 3D) and speed / tempo / pitch (WSOLA), shared `Control`. |
| `music-shield` | Ad and tracker blocking with Brave's adblock engine, plus the YouTube player script. |
| `music-plugins` | Third-party plugins: one QuickJS runtime per plugin (64 MB, 1 s per run, no DOM, network or files), manifest and permissions checked in Rust, HTTPS gateway to approved public hosts. Author guide: `docs/plugins.md`. |
| `src-tauri` | IPC commands (`lib.rs`, and per feature: `detector.rs`, `editor.rs`, `themes.rs`, `syncmode.rs`, `plugins.rs`), OS keychain, WebView2 request hook, Windows media panel, tray icon, window background, voice search through Windows' speech recognition (`speech.rs`). No business logic. |

## Rules

- **Logic lives in `crates/`.** The shell only connects the crates to the window.
- **One door to Rust.** `ui/src/shared/api.ts` is the only file that calls `invoke`. Its wrappers are written by hand,
  its types are not: they come from the Rust ones (see "IPC types" below).
- **The interface never touches the network.** Images go through the `art` URI scheme (`src-tauri/src/art.rs`): host
  allowlist, disk cache under a size cap, thumbnails (`?s=64|256|600`) for lists; rules in `crates/core/src/artcache.rs`.
- **Secrets in the OS keychain** (`keyring`). Settings and the library are local (SQLite).
- **Legal playback only.** Official players and the user's own files; no audio extraction. Live processing of what
  plays (Adaptive Sound…) is allowed; downloading, recording or exporting a platform's audio never is. See
  [playback.md](playback.md).
- **Settings schema.** One typed schema (`ui/src/shared/theme/theme.ts`), sanitized on load. Changing a default for
  everyone bumps `DEFAULTS_VERSION`.
- **Database schema.** Migrations keyed on SQLite `user_version` (`crates/core/src/library.rs`).

## IPC types

Every type a command, an event or a plugin call carries is a Rust type (struct or enum) that derives `ts_rs::TS` and
carries `#[ts(export)]` ([ts-rs](https://github.com/Aleph-Alpha/ts-rs), types only: the `invoke` wrappers in `api.ts`
stay by hand). `pnpm types` (`scripts/types.mjs`) runs ts-rs's export tests (`cargo test --workspace --lib
export_bindings`) into a temporary folder and, only once cargo has succeeded, empties `ui/src/shared/generated/` and
fills it with the result and `index.ts` (a Rust compile error leaves the committed files alone); `api.ts` re-exports the lot, so features keep
importing from the API. The files are committed (LF) and `pnpm check` runs the step first, so the type check never
sees stale types: a changed Rust type breaks the TypeScript build at once. CI (Windows job) fails when the result
differs from the commit.

- Where and how: `.cargo/config.toml` (`TS_RS_EXPORT_DIR`, and `TS_RS_LARGE_INT = "number"`: i64 / u64 are numbers
  here, never `bigint`). One flat folder: two types can't share a TS name, so `#[ts(rename = "UpdateStatus")]` gives the
  interface's name to Rust's `update::Status`.
- serde attributes come through (`rename_all`, `tag`, `flatten` inlined, `skip`). One serde attribute ts-rs doesn't know
  prints a warning, which Clippy turns into an error: use one it knows (`Effects::eq` uses `with`, not `deserialize_with`).
- Tune the TypeScript from Rust: `#[ts(optional)]` / `#[ts(optional = nullable)]` for what the interface may leave out
  (serde skips it, or defaults it), `#[ts(as = "Vec<f32>")]` for fixed-size arrays, `#[ts(type = "…")]` for a literal
  union kept as a `&'static str` in Rust, `#[ts(skip)]` for a field the interface never reads or that repeats a flattened
  key (`search::Hit::musicness`).
- Not generated: JSON blobs the interface validates itself (settings, saved session, themes), and front-end-only types.
- A new command: give its argument and result types the derive and the attribute, run `pnpm types`, name them in the
  wrapper (`invoke<NewType>('new_command')`), commit the files.

## Caching

`crates/core/src/cache.rs`, all in memory and bounded:

- SQLite's update hook bumps a library or history version on every row written. Library, playlist, play stats and
  mixes answers are kept as ready-to-send JSON until their version changes (mixes also on a new day or hour), so no
  write path can forget to invalidate.
- Library change log: temp triggers note every song and playlist row written, whatever wrote it. After an edit the UI
  asks `library_changes` for those rows only (plus the rest of their channels: talk-channel musicness) and patches its
  copy (`ui/src/app/libraryPatch.ts`: unchanged rows keep their objects, new ones land where a whole read puts them).
  Startup, syncs, imports and sign-ins read the library whole, as does any change of more than 5,000 songs; a whole
  read empties the log. Never `INSERT OR REPLACE` into the library tables: the rows it drops fire no trigger.
- Images: a 64 MB memory LRU in front of the 300 MB disk cache; the same image asked by many rows at once is read or
  downloaded once.
- Network answers (YouTube Music and Apple searches) for 30 minutes; sign-in state for 30 seconds, cleared on
  sign-in, sign-out, connect and disconnect.

## Interface

- `ui/src/app/`: shell, navigation store, settings, keyboard shortcuts, screen restore.
- `ui/src/features/<name>/`: one folder per feature. Right-click menus are built in `features/menus.tsx`.
- `ui/src/shared/`: typed API, formatting, themes, image helpers and the small component kit (`shared/ui/`).
- Long lists are virtualized (`@tanstack/react-virtual`).
- Languages: `ui/src/shared/i18n/` (no library). English text is the key: `tr('Play')`, `trn(n, '{n} song', '{n} songs')`
  (the language's plural rules), `msg()` marks text kept in tables and translated where shown. `fr.ts` maps English
  to French; a test scans the code and fails on a missing or stale translation. Language = Windows' (the webview's)
  or the user's pick; changing it re-renders in place. Each language's table loads on demand (`loadLang`), the one in
  use before the first render (`main.tsx` awaits it): the startup script went from 2.4 MB to 0.54 MB (2026-10-28).
  The shell's own words (tray, taskbar buttons) follow through
  `src-tauri/src/lang.rs`. Mix titles come from Rust as parts (`mixes::Words`) and are worded by the UI.
  Mixes' new songs: the core names its seeds (`mixes::seeds`), the shell fetches YouTube Music's radio of each and hands
  them back (`Input::found`); the core stays without network.
  Not translated: messages from services and Rust errors, YouTube Music's own shelf titles (its parsing reads
  English), Discord presence buttons (shown on Discord).

## Player

- The queue lives in the interface (`features/player/store.ts`). Each track plays through its best source: local
  file, then full YouTube, then a 30-second preview.
- Consecutive local files are sent to the Rust engine as one run, so they stay gapless.
- YouTube plays in one persistent embedded player that switches videos instead of reloading.
- Playback state is saved and restored on launch (`session.ts`), as is the last screen (`app/screen.ts`).
- Launch order: window background (`window_bg.rs`), library (opened in `setup`: the window's colour and the shield switch
  come from its settings), UI, then the UI's `app_ready` (`src-tauri/src/deferred.rs`), then the plugins and the update and
  Sync Mode rounds; in the page, Discord, Last.fm, Sync Mode's messages and the plugin host (`app/deferred.ts`), then
  the other pages preloaded when idle. A timer starts the Rust side after 8 s anyway (a hidden start at login does
  not paint, a broken build never says ready: an update must still be able to repair it); a gate lets it run once, a
  page reload included. The shield's lists load right away, in their own task: the first YouTube request, a resumed
  song's, must already meet them. Pages (`app/pages.ts`) load on first visit; the shell, sidebar, player and shortcuts
  are in the first chunk, a page loading leaves the shell standing (`PageBoundary`: `Suspense`, no fallback). A chunk that fails to load shows
  "Couldn’t load this page" + Try again in that spot only; the next draw asks for the chunk anew.

## Updates

`src-tauri/src/update.rs` with `tauri-plugin-updater`: checked 5 s after the UI says ready at every launch, when the window comes back from
the tray after more than an hour, and every 6 hours (release builds). With Automatic updates on (Settings › About) it
downloads in the background, else it only announces the version. Signature checked against the public key in
`tauri.conf.json`. The interface (`features/update/updates.ts`) installs it without cutting a song: when a song ends on
its own (nobody touched the app for a minute) the session is saved on the next song and the installer runs, or at a
quiet moment (nothing played for 15 s, no input for a minute). The installer runs silently and starts the app again,
which reopens as it was (queue, screen) and plays the next song. Settings › About shows the version and its channel,
the update state and the app's caches. Only the installed app (identifier `app.legato.desktop`) updates: any other
build, dev, bench or e2e, never installs (`identity.rs`, [development.md](development.md)).

Two channels, picked in Settings › General › Updates (UI setting `updateChannel`, Stable by default, one of the
settings Sync Mode leaves on each PC). Stable reads the endpoint of `tauri.conf.json`,
`releases/latest/download/latest.json`: GitHub's "latest" skips prereleases and every installed version has always read
that URL. Beta reads `releases/download/beta/latest.json`, the rolling `beta` release that `release.yml` refreshes
after each green push (every push is a prerelease). `update::Channel` picks the endpoint (pure, tested); Beta builds its
updater with `updater_builder().endpoints(…)`, same plugin and same signature key. The plugin's default comparator only
takes a version newer than the installed one, so Beta → Stable never downgrades. Choosing a channel
(`save_settings` → `Updater::switched`) drops what was found or downloaded and checks the new one at once; a pass
running at that moment looks again when it ends. `promote.yml` / `scripts/promote.mjs` turn a beta into Stable
(CONTRIBUTING › Releasing).

## Diagnostics

A local log for bug reports, nothing sent: `diagnostics.log` (then `.1` to `.4`, 1 MB each, 5 MB at most) in the app data
folder. `crates/core/src/diag.rs` is the pure part: the size-rotating writer (the time-based appenders of `tracing` can't
hold a size), the line (`2026-10-30T12:34:56.789Z WARN update check failed | the raw error`), the redaction and the report
text. `src-tauri/src/diag.rs` runs a writer thread (a caller only queues a line, so a slow disk never holds up the
window; the file opens at the first line), a panic hook chained to the default one, and two async commands: `diag_log`
(the interface's errors and playback switches, `shared/diag.ts`: throttled, one line per minute at most per text, 30 a
minute) and `diag_report`. The updater, Sync Mode, sync reports, YouTube Music refusals, the Google session refresh and
the startup stop log from Rust. Rust lines are not throttled: Sync Mode's minute timer therefore logs a failed folder
round once, and again only when the failure text changes or a round succeeds in between (else one line a minute would
push a real crash out of the report's 20 latest problems).

A line is a message and an optional detail. The message is our own words in English (a service, a kind of failure: no
song title, account name or path); the detail is what the error said, and is copied out only with "Include details".
Secrets (URL queries, tokens, cookies, emails) are cut before a line reaches the file; without details a copied report
also hides the user's folder and name in paths. Settings › About › Copy diagnostics builds the text: version, Windows
build, WebView2 version, the settings that matter, who is signed in, the latest warnings and errors, the latest events.
The interface forwards uncaught errors, unhandled rejections, errors shown in its alert and a top-level error boundary
(`app/ErrorBoundary.tsx`: a calm page with Reload and Copy diagnostics).

## Background (tray)

`src-tauri/src/background.rs`: closing the window keeps the app in the notification area (Settings › General, on by
default), music playing. Hidden, the WebView2 controller is set invisible (no painting, page `hidden`) and its memory
target low; after 5 minutes hidden with nothing playing it is suspended, and woken before the tray, a global shortcut,
a media key or showing the window reach it: the page is then held `visible` until the music moves (a hidden page
stayed frozen after `Resume()`, the key was lost). A second launch shows the running one (single instance). Quit in
the tray menu is the only exit. Measured: WebView2 working set 867 MB shown → 96 MB hidden, music on.

## Add-ons

Optional built-in features, listed in `ui/src/features/addons/registry.ts` with their author and a verified mark, and
turned on in settings. No third-party code is loaded. Discord Rich Presence talks to the local Discord app over its
IPC pipe (`crates/connectors/src/discord.rs`), from a dedicated thread in `src-tauri/src/discord.rs`.

## Testing

- Rust tests sit in each module (`#[cfg(test)]`); front-end tests sit next to the code (`*.test.ts`, Vitest).
- Tests never use the real network: connectors are tested against `mockito`.
- `pnpm e2e` drives the built app like a new user: a debug build with the `e2e` cargo feature (own identifier, the network
  on a loopback mock in `hosts.rs`, a silent audio output in `crates/player/src/output.rs`), a script over WebView2's
  DevTools port (`e2e/smoke.mjs`). Windows CI runs it in the `e2e` job ([development.md](development.md)).
- `pnpm check` runs everything: the Rust → TypeScript types, type check, ESLint, Vitest, Clippy with warnings as errors,
  `cargo test`.
