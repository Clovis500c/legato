<div align="center">

# Music App

**One library for YouTube Music, Spotify, Apple Music and your own files.**

A fast, private desktop music player for Windows, built with Tauri 2 and Rust.

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![Rust](https://img.shields.io/badge/Rust-2024-B7410E)
![License](https://img.shields.io/badge/license-source--available-lightgrey)

![Music App library](docs/images/songs.png)

</div>

## Features

- **Unified library.** The same song on several services becomes one track (matched by ISRC, or title, artist and
  duration). Songs, Albums, Artists and Playlists views, instant search, YouTube-style sorting.
- **One player for every source.** Local files (native, gapless), YouTube (official embedded player), Apple Music
  previews and Spotify Connect share one queue, with crossfade, an immersive Now Playing screen and a mini player.
- **Playlists.** Import from YouTube Music and Spotify, create your own, export to YouTube Music, and share them by
  link, QR code or a 6-digit code on your local network.
- **Mixes made on your PC.** Daily Mixes, a time-of-day mix and Rediscover, built from your own listening history.
- **Windows integration.** Media keys, the Windows media panel, tray icon, keyboard shortcuts, system light/dark mode
  and accent color.
- **Customization.** Themes with a built-in editor, layout and player options.
- **Add-ons.** Optional extras, off by default. First available: Discord Rich Presence.
- **Ad and tracker blocking**, built in.

## Privacy and playback

- **No server, no account of ours.** Your library is a local SQLite database; tokens stay in the Windows Credential
  Manager.
- **Official playback only.** Music plays through each service's own player or from your files. Nothing is downloaded
  or extracted. Sound features (Adaptive Sound) process what plays as it plays, in memory: nothing is recorded or
  saved, and Settings › Advanced can keep YouTube's sound untouched.
- **One gateway to the network.** All requests go through the Rust core; the interface never calls the network itself.
- **Voice search (off until you allow it).** The mic uses Windows' own online speech recognition: while it listens,
  your voice goes to Microsoft's speech service through Windows. The app keeps nothing.

## Getting started

Requirements: Windows 10 or 11 (WebView2), [Rust](https://rustup.rs) stable, Node.js 22 or later and
[pnpm](https://pnpm.io).

```bash
pnpm install
```

```bash
pnpm dev
```

Then connect your services in **Settings › Accounts**:

| Service | How it connects |
|---|---|
| YouTube Music | Sign in with Google, on Google's own page. Several accounts supported. |
| Spotify | Your own app from the Spotify Developer Dashboard (Premium needed in development mode), or paste public playlist links. |
| Apple Music | Catalog search and 30-second previews, no account needed. |
| Local files | Add your music folders. |

## Development

| Command | Description |
|---|---|
| `pnpm dev` | Run the app with hot reload |
| `pnpm check` | Type check, lint, tests (Vitest and cargo) and Clippy. Must pass before every commit |
| `pnpm build` | Build the Windows installer (needs cargo-about for its license notices, see [docs/licenses.md](docs/licenses.md)) |

```
crates/core         Library model, track matching, SQLite, sync, mixes, sharing
crates/connectors   YouTube Music, Spotify, Apple Music catalog, Discord, nearby sharing
crates/player       Native audio engine (rodio, symphonia) with a gapless queue
crates/shield       Ad and tracker blocker
src-tauri           Desktop shell: IPC commands, keychain, Windows integration
ui                  React 19 interface (Zustand, Tailwind CSS 4), organized by feature
```

More in [docs/](docs/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Source-available, not open source. You may use the app for free. Issues and pull requests are welcome; changing the
code for any other purpose, or reusing any part of it in another project, requires the author's written permission.
See [LICENSE](LICENSE).

Spotify, YouTube, Apple Music and Discord are trademarks of their respective owners. Service logos come from
[Simple Icons](https://simpleicons.org) (CC0).
