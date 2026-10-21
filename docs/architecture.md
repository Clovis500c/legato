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
| `music-core` | Track model, matching (ISRC, then title + artist + duration), SQLite library with versioned migrations, sync, local file scan, listening history and mixes, share codes, search merging and the music / not music classifier. No Tauri, no network. |
| `music-connectors` | One module per service. Shared OAuth PKCE loopback (Spotify), YouTube Music web session, normal YouTube search, iTunes catalog, Discord IPC, nearby sharing (mDNS + SPAKE2), image cache. Base URLs are injectable for tests. |
| `music-player` | Native playback of local files and previews (rodio, symphonia) on its own thread, with a gapless queue. |
| `music-shield` | Ad and tracker blocking with Brave's adblock engine, plus the YouTube player script. |
| `src-tauri` | IPC commands, OS keychain, WebView2 request hook, Windows media panel, tray icon, window background. No business logic. |

## Rules

- **Logic lives in `crates/`.** The shell only connects the crates to the window.
- **One door to Rust.** `ui/src/shared/api.ts` is the only file that calls `invoke`. Its types mirror the Rust ones by
  hand and must be kept in sync.
- **The interface never touches the network.** Images go through the `art` URI scheme (`src-tauri/src/art.rs`): host
  allowlist, disk cache.
- **Secrets in the OS keychain** (`keyring`). Settings and the library are local (SQLite).
- **Legal playback only.** Official players and the user's own files; no audio extraction. See [playback.md](playback.md).
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

## Player

- The queue lives in the interface (`features/player/store.ts`). Each track plays through its best source: local
  file, then full YouTube, then a 30-second preview.
- Consecutive local files are sent to the Rust engine as one run, so they stay gapless.
- YouTube plays in one persistent embedded player that switches videos instead of reloading.
- Playback state is saved and restored on launch (`session.ts`), as is the last screen (`app/screen.ts`).

## Updates

`src-tauri/src/update.rs` with `tauri-plugin-updater`: checked 20 s after launch and every 6 hours (release builds),
downloaded in the background, signature checked against the public key in `tauri.conf.json`. The interface
(`features/update/updates.ts`) installs it at a quiet moment: nothing played for 15 s and no input for a minute. The
installer runs silently and starts the app again, which reopens as it was (queue, position, paused or not, screen).
Settings › About shows the version, the update state and the app's caches.

## Add-ons

Optional built-in features, listed in `ui/src/features/addons/registry.ts` with their author and a verified mark, and
turned on in settings. No third-party code is loaded. Discord Rich Presence talks to the local Discord app over its
IPC pipe (`crates/connectors/src/discord.rs`), from a dedicated thread in `src-tauri/src/discord.rs`.

## Testing

- Rust tests sit in each module (`#[cfg(test)]`); front-end tests sit next to the code (`*.test.ts`, Vitest).
- Tests never use the real network: connectors are tested against `mockito`.
- `pnpm check` runs everything: type check, ESLint, Vitest, Clippy with warnings as errors, `cargo test`.
