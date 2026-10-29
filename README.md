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

- **One library**: the same song on several services is one track.
- **One search** across your library, YouTube, YouTube Music and Apple Music.
- **One player** for every source, with crossfade, lyrics and a visualizer.
- **Playlists**: import, create, export to YouTube Music, share by link or QR code.
- **Sync per account**: both ways, import only, send only, or off.
- **Mixes and stats** made on your PC, Last.fm scrobbling.
- **Live Editor**: speed, pitch, 10-band EQ, reverb, distortion, 3D / 8D, as it plays.
- **Your own files**: gapless playback, edit their title, artist, album and cover.
- **Sync Mode**: your library on all your PCs ([details](docs/sync-mode.md)).
- **Themes**: colors, fonts, a picture or video background, your own CSS.
- **Plugins** and add-ons ([writing one](docs/plugins.md)), ad blocking built in.
- **17 languages**, Windows media keys, tray icon, full screen.

## Privacy

- No server and no account of ours: your library stays on your PC, tokens in the Windows Credential Manager.
- Official playback only: nothing is downloaded or extracted ([details](docs/playback.md)).
- The interface never calls the network itself: everything goes through the Rust core.
- Voice search, the Music Detector and Sync Mode stay off until you turn them on.

What leaves your PC, and when: [docs/privacy.md](docs/privacy.md).

## Getting started

Requirements: Windows 10 or 11 (WebView2), [Rust](https://rustup.rs) stable, Node.js 22 or later and
[pnpm](https://pnpm.io).

```bash
pnpm install
```

```bash
pnpm dev
```

Then connect your services in **Settings › Accounts**: YouTube Music (sign in with Google), Spotify (your own app key),
Apple Music (no account needed) and your music folders.

## Development

| Command | Description |
|---|---|
| `pnpm dev` | Run the app with hot reload |
| `pnpm check` | Type check, lint, tests and Clippy. Must pass before every commit |
| `pnpm build` | Build the Windows installer |

More in [docs/](docs/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Source-available, not open source. You may use the app for free. Issues and pull requests are welcome; changing the
code for any other purpose, or reusing any part of it in another project, requires the author's written permission.
See [LICENSE](LICENSE).

Spotify, YouTube, Apple Music and Discord are trademarks of their respective owners. Service logos come from
[Simple Icons](https://simpleicons.org) (CC0).
