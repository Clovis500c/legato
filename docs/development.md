# Development setup

Everything a developer needs beyond `pnpm install`: tools per system, the accounts the app signs in to, and where it
keeps secrets and data. Written 2026-10-17; re-check the Spotify part when Spotify changes its dashboard.

## Tools

| System | What to install |
|---|---|
| Windows 10 or 11 | [Rust](https://rustup.rs) stable (MSVC), Node.js 22 or later, [pnpm](https://pnpm.io) 10. WebView2 comes with Windows 11. |
| macOS | Xcode Command Line Tools (`xcode-select --install`), Rust, Node.js 22, pnpm 10. |
| Linux (Debian, Ubuntu) | Rust, Node.js 22, pnpm 10, and the packages below. |

```bash
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libasound2-dev libdbus-1-dev
```

Windows is the app's platform. In CI, macOS builds the whole app and passes every check; Linux checks the Rust crates
only (no WebKitGTK download from slow mirrors). The app has never been driven on either:
the media panel, the ad shield's network hook and the system accent are Windows only.

## Your dev build uses your real data

`pnpm dev` runs with the same identifier as an installed copy (`dev.musicapp.desktop`), so it reads and writes the same
library, the same keychain entries and the same Google session. Copy `library.db` before trying risky changes.

Two things only an installed copy does: Settings › General › Open at startup refuses to turn on (a dev build would
start at sign-in without its dev server), and background update checks only run when asked (Settings › About).

| What | Windows | macOS | Linux |
|---|---|---|---|
| Library (`library.db`), cover cache (`art/`), shield lists (`shield/`) | `%APPDATA%\dev.musicapp.desktop` | `~/Library/Application Support/dev.musicapp.desktop` | `~/.local/share/dev.musicapp.desktop` |
| Google session (webview cookies) | `%LOCALAPPDATA%\dev.musicapp.desktop\EBWebView` | The system webview's own store | The system webview's own store |
| Secrets | Credential Manager | Keychain | Secret Service |

## YouTube Music (no keys)

Settings › Accounts › Sign in opens Google's own sign-in page in an app window. The app never sees the password: once
the window is back on music.youtube.com with a session, it closes, and the app reads the session cookies from the
webview when it calls YouTube Music (`src-tauri/src/ytm.rs`). Nothing goes in the keychain. Sign out clears the whole
webview profile.

- The API is YouTube Music's own web API (InnerTube), unofficial: a change on YouTube's side can break a parser. The
  parsers have tests on sample responses (`crates/connectors/src/ytmusic.rs`, `ytmusic/home.rs`): when a real
  response stops parsing, add its shape there first.
- Writes are real. Exporting a playlist, adding to a playlist or liking a song changes your Google account. Use a
  secondary account for that kind of testing.

## Spotify (optional, your own key)

Spotify has no keyless sign-in, so each user brings a Client ID. Without one, public playlist links still import
(`crates/connectors/src/spotify_embed.rs`).

1. [Spotify developer dashboard](https://developer.spotify.com/dashboard) › Create app. Any name and description; tick
   "Web API".
2. Redirect URIs: add exactly `http://127.0.0.1/callback` (no port, `127.0.0.1` and not `localhost`), then Save.
3. Copy the Client ID (not the secret: the app uses PKCE) into Settings › Accounts › Spotify.
4. Sign in: the browser opens Spotify's page, and the app waits for the redirect on `http://127.0.0.1:<free
   port>/callback` for 5 minutes (`crates/connectors/src/oauth.rs`). Spotify accepts any port on a loopback address.

Development mode limits: the app owner needs Premium, and only accounts added under the app's User Management (5 at
most) can sign in.

| Symptom | Cause |
|---|---|
| "INVALID_CLIENT: Invalid redirect URI" on Spotify's page | The redirect URI isn't exactly `http://127.0.0.1/callback`, or wasn't saved. |
| "Sign-in timed out" | No redirect within 5 minutes. Start again. |
| Sign-in works, then 403 errors | The account isn't in User Management, or the owner has no Premium. |

## Keychain

Secrets go through the `keyring` crate (`src-tauri/src/secrets.rs`): service `dev.musicapp.desktop`, one entry per
key, JSON values.

| Entry | Holds |
|---|---|
| `credentials` | `{"spotifyClientId": "…"}` |
| `spotify` | Spotify tokens: `accessToken`, `refreshToken`, `expiresAt` (epoch ms). Refreshed by the app. |

To look at or delete them (here for `spotify`):

| System | List | Delete |
|---|---|---|
| Windows | `cmdkey /list:spotify.dev.musicapp.desktop` (or Credential Manager › Windows Credentials) | `cmdkey /delete:spotify.dev.musicapp.desktop` |
| macOS | `security find-generic-password -s dev.musicapp.desktop -a spotify` | `security delete-generic-password -s dev.musicapp.desktop -a spotify` |
| Linux | `secret-tool search service dev.musicapp.desktop` | `secret-tool clear service dev.musicapp.desktop username spotify` |

Linux needs a running Secret Service (GNOME Keyring, or KWallet with its Secret Service on). Without one, nothing can
be saved and Spotify stays signed out.

Full reset: delete both keychain entries, the data folder and the webview profile above.

## Tests never use your accounts

Tests use `MemoryStore` (`crates/core/src/model.rs`) instead of the keychain, and every connector takes its base URLs as
parameters (`with_urls`) so tests point it at a local [mockito](https://docs.rs/mockito) server. No test may reach the
real network.

CI enforces it: `pnpm check` runs with every proxy variable pointing at a dead port, so a request to anything but
`127.0.0.1` fails the test that made it. Same thing locally (bash):

```bash
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost cargo test --workspace
```

The YouTube Music parsers also get reshuffled and broken answers (`parsers_survive_unknown_shapes`): when the unofficial
API changes, the app shows nothing for that part rather than crashing.
