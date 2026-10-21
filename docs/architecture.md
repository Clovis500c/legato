# Architecture

Music App is a Tauri 2 desktop app: a Rust core does the work, and a React interface draws it in a WebView2 window.
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
| `music-core` | Track model, matching (ISRC, then title + artist + duration), SQLite library with versioned migrations, sync, Sync Mode between PCs (snapshot, merge, sealing), local file scan, listening history and mixes, share codes, search merging and the music / not music classifier. No Tauri, no network. |
| `music-connectors` | One module per service. Shared OAuth PKCE loopback (Spotify), YouTube Music web session, normal YouTube search, iTunes catalog, LRCLIB lyrics, AudD song recognition (user's token), Discord IPC, nearby sharing and Sync Mode's network swap (mDNS + SPAKE2), image cache. Base URLs are injectable for tests. |
| `music-player` | Native playback of local files and previews (rodio, symphonia) on its own thread, with a gapless queue, through the live processing chain. Live Editor export of local files (WAV). Microphone clips for the Music Detector (memory only). |
| `music-dsp` | Live audio processing, pure Rust: biquads, BS.1770 loudness meter, Adaptive Sound gain, limiter, the Live Editor's effects (EQ, compressor, width, echo, reverb, 3D) and speed / tempo / pitch (WSOLA), shared `Control`. |
| `music-shield` | Ad and tracker blocking with Brave's adblock engine, plus the YouTube player script. |
| `src-tauri` | IPC commands, OS keychain, WebView2 request hook, Windows media panel, tray icon, window background, voice search through Windows' speech recognition (`speech.rs`). No business logic. |

## Rules

- **Logic lives in `crates/`.** The shell only connects the crates to the window.
- **One door to Rust.** `ui/src/shared/api.ts` is the only file that calls `invoke`. Its types mirror the Rust ones by
  hand and must be kept in sync.
- **The interface never touches the network.** Images go through the `art` URI scheme (`src-tauri/src/art.rs`): host
  allowlist, disk cache.
- **Secrets in the OS keychain** (`keyring`). Settings and the library are local (SQLite).
- **Legal playback only.** Official players and the user's own files; no audio extraction. Live processing of what
  plays (Adaptive Sound…) is allowed; downloading, recording or exporting a platform's audio never is. See
  [playback.md](playback.md).
- **Settings schema.** One typed schema (`ui/src/shared/theme/theme.ts`), sanitized on load. Changing a default for
  everyone bumps `DEFAULTS_VERSION`.
- **Database schema.** Migrations keyed on SQLite `user_version` (`crates/core/src/library.rs`).

## Caching

`crates/core/src/cache.rs`, all in memory and bounded:

- SQLite's update hook bumps a library or history version on every row written. Library, playlist, play stats and
  mixes answers are kept as ready-to-send JSON until their version changes (mixes also on a new day or hour), so no
  write path can forget to invalidate.
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
  or the user's pick; changing it re-renders in place. The shell's own words (tray, taskbar buttons) follow through
  `src-tauri/src/lang.rs`. Mix titles come from Rust as parts (`mixes::Words`) and are worded by the UI.
  Not translated: messages from services and Rust errors, YouTube Music's own shelf titles (its parsing reads
  English), Discord presence buttons (shown on Discord).

## Player

- The queue lives in the interface (`features/player/store.ts`). Each track plays through its best source: local
  file, then full YouTube, then a 30-second preview.
- Consecutive local files are sent to the Rust engine as one run, so they stay gapless.
- YouTube plays in one persistent embedded player that switches videos instead of reloading.
- Playback state is saved and restored on launch (`session.ts`), as is the last screen (`app/screen.ts`).

## Updates

`src-tauri/src/update.rs` with `tauri-plugin-updater`: checked 5 s after every launch, when the window comes back from
the tray after more than an hour, and every 6 hours (release builds). With Automatic updates on (Settings › About) it
downloads in the background, else it only announces the version. Signature checked against the public key in
`tauri.conf.json`. The interface (`features/update/updates.ts`) installs it without cutting a song: when a song ends on
its own (nobody touched the app for a minute) the session is saved on the next song and the installer runs, or at a
quiet moment (nothing played for 15 s, no input for a minute). The installer runs silently and starts the app again,
which reopens as it was (queue, screen) and plays the next song. Settings › About shows the version, the update state
and the app's caches.

## Background (tray)

`src-tauri/src/background.rs`: closing the window keeps the app in the notification area (Settings › Advanced, on by
default), music playing. Hidden, the WebView2 controller is set invisible (no painting, page `hidden`) and its memory
target low; after 5 minutes hidden with nothing playing it is suspended, and woken before the tray, a global shortcut,
a media key or showing the window reach it. A second launch shows the running one (single instance). Quit in the tray
menu is the only exit. Measured: WebView2 working set 867 MB shown → 96 MB hidden, music on.

## Add-ons

Optional built-in features, listed in `ui/src/features/addons/registry.ts` with their author and a verified mark, and
turned on in settings. No third-party code is loaded. Discord Rich Presence talks to the local Discord app over its
IPC pipe (`crates/connectors/src/discord.rs`), from a dedicated thread in `src-tauri/src/discord.rs`.

## Testing

- Rust tests sit in each module (`#[cfg(test)]`); front-end tests sit next to the code (`*.test.ts`, Vitest).
- Tests never use the real network: connectors are tested against `mockito`.
- `pnpm check` runs everything: type check, ESLint, Vitest, Clippy with warnings as errors, `cargo test`.
