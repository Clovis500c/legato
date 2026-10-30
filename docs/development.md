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

## Your dev build has its own data

`pnpm dev` runs as `app.legato.desktop.devbuild` (`src-tauri/tauri.dev.conf.json`): its own library, keychain entries
and Google session, never the installed app's.

Only the installed app, identifier exactly `app.legato.desktop`, may touch the PC outside its own folders
(`src-tauri/src/identity.rs`, `identity::installed()`): install an update over itself (`update.rs`), own the HKCU Run
entry that Open at startup writes (`autostart.rs`: a dev build asking would start at sign-in without its dev server),
and move the folders and keychain entries of the old identifier `dev.musicapp.desktop` at first launch (`rename.rs`).
A dev build, the bench build (`app.legato.desktop.bench`), the smoke test build (`app.legato.desktop.e2e`) or any other identifier is a guest: it never installs, never
edits the Run entry and never migrates (a dev folder still named `dev.musicapp.desktop.devbuild` is renamed by hand). A
dev build only checks for updates when asked (Settings › About), and cannot install what it finds. Any new side effect a
release build has on the PC goes behind the same guard.

| What | Windows | macOS | Linux |
|---|---|---|---|
| Library (`library.db`), cover cache (`art/`), shield lists (`shield/`), diagnostics log (`diagnostics.log`, `.1` to `.4`) | `%APPDATA%\app.legato.desktop` | `~/Library/Application Support/app.legato.desktop` | `~/.local/share/app.legato.desktop` |
| Google session (webview cookies) | `%LOCALAPPDATA%\app.legato.desktop\EBWebView` | The system webview's own store | The system webview's own store |
| Secrets | Credential Manager | Keychain | Secret Service |

## Measuring: `pnpm bench`

`pnpm bench` builds the release app under its own identifier (`src-tauri/tauri.bench.conf.json`), fills a fresh data
folder with 10 000 local songs (`crates/core/examples/bench_data.rs`) and reads start time, RAM and CPU: paused, playing,
and 10 minutes in the tray. `--quick` is a short run. The numbers, how they are taken and what they leave out are in
[performance.md](performance.md); a full run appends its row there. Windows only, and about 20 minutes of a PC left alone.
`scripts/cdp.mjs` is its small DevTools client; the E2E smoke test reuses it.

## Smoke test: `pnpm e2e`

`pnpm e2e` builds the app as a guest (`tauri build --debug --no-bundle --features e2e`, identifier
`app.legato.desktop.e2e`, `src-tauri/tauri.e2e.conf.json`, the exe copied to `target/e2e`) and walks a new user's first
minutes through its real window, over WebView2's DevTools port (`scripts/cdp.mjs`, the flags of `scripts/guest.mjs`): the
welcome comes first, Add folder (three WAV songs the test writes, `e2e/wav.mjs`), the Songs page lists them, a song plays
3 s and the engine's position moves, Pause freezes it and Play moves it again, a search (suggestions, YouTube, YouTube
Music and Apple, all answered by `e2e/mock.mjs` from `e2e/fixtures`) while the song plays on, the window's Close with
"Keep running in the notification area" off (the app must end by itself, exit code 0), then the same data again: no
welcome, the library is still there. About 15 s once built. A failure leaves screenshots, `failure.txt` (the step, the page's
text, what the mock saw, the diagnostics log) in `target/e2e/shots`; CI uploads them. `--repeat 5` walks five times on one
build, `--skip-build` reuses an unchanged build. The `e2e` job of `check.yml` runs it on Windows, the build and then the
walk as two steps, the walk held to 5 minutes. Checked on 2026-10-30: with the click handler of the player's play button
emptied, the walk fails at `pause-play` ("Pause did not pause"), exit code 1, screenshot and report left.

What the `e2e` cargo feature changes, and nothing else, in a build nobody installs:

- **Network** (`src-tauri/src/hosts.rs`): search, suggestions, lyrics and the Apple lookups go to one loopback server, read
  from `LEGATO_E2E_MOCK` (only `http://127.0.0.1:<port>` is taken; without it, a dead port). A normal build has the real
  hosts compiled in and no variable, setting or file moves them. The script also puts every other host behind a dead proxy,
  so a call the mock does not stand for fails at once, and refuses an exe that lacks the variable's name (a build without
  the feature). Each connector has a test that its mock fixture still reads (`smoke_test_fixture_reads`): change a parser,
  change `e2e/fixtures`.
- **Sound** (`crates/player/src/output.rs`, feature `null-output`): no audio device. A thread drains the mixer at the pace of
  a real one, so the song decodes, goes through the live chain and moves its position on a CI runner without a sound card,
  and a dev PC stays silent. The real device path is the one thing the walk does not cover.

The native folder picker is an OS dialog a page cannot drive: the script answers its IPC request (CDP `Fetch`), and the
rest of the interface runs as when a person picks. Only the two data folders of `.e2e` are ever deleted
(`e2eFolders`, like the bench's). Like the bench, it never touches the installed app (`identity.rs`).

## YouTube Music (no keys)

Settings › Accounts › Sign in opens Google's own sign-in page in an app window. The app never sees the password: once
the window is back on music.youtube.com with a session, it closes, and the app reads the session cookies from the
webview when it calls YouTube Music (`src-tauri/src/ytm.rs`). Nothing goes in the keychain. Sign out clears the whole
webview profile.

Google renews those cookies from its own pages, which the app never shows: left alone they kept their sign-in date and
after days Google answered 401 "You must be signed in" (likes failed, 2026-10-28). `ytm::refresh` opens the same
sign-in page hidden; a live session goes straight back to music.youtube.com with fresh cookies. It runs 90 s after
launch, then every 12 h, and on a 401 before one more try (likes, unlikes, sync). A like YouTube still refuses waits
in your own "Liked Music" list; the next sync likes it on the account and moves it there.

Artist pages (`ytm_artist`) and the albums and playlists opened from them are public: asked without the account
(`YouTubeMusic::anonymous`), so they work signed out too. So do song searches signed out (`AppState::ytm_or_public`):
Search, Spotify link and song list imports, Find full versions, another upload of a blocked video.

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

Secrets go through the `keyring` crate (`src-tauri/src/secrets.rs`): service `app.legato.desktop`, one entry per
key, JSON values.

| Entry | Holds |
|---|---|
| `credentials` | `{"spotifyClientId": "…"}` |
| `spotify` | Spotify tokens: `accessToken`, `refreshToken`, `expiresAt` (epoch ms). Refreshed by the app. |

To look at or delete them (here for `spotify`):

| System | List | Delete |
|---|---|---|
| Windows | `cmdkey /list:spotify.app.legato.desktop` (or Credential Manager › Windows Credentials) | `cmdkey /delete:spotify.app.legato.desktop` |
| macOS | `security find-generic-password -s app.legato.desktop -a spotify` | `security delete-generic-password -s app.legato.desktop -a spotify` |
| Linux | `secret-tool search service app.legato.desktop` | `secret-tool clear service app.legato.desktop username spotify` |

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
