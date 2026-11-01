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
dev build only checks for updates when asked (Settings › About), and cannot install what it finds: it can download, and
its install ends in an error (the status leaves Ready, or the interface would ask again every 5 s). Any new side effect a
release build has on the PC goes behind the same guard.

| What | Windows | macOS | Linux |
|---|---|---|---|
| Library (`library.db`), cover cache (`art/`), shield lists (`shield/`), diagnostics log (`diagnostics.log`, `.1` to `.4`) | `%APPDATA%\app.legato.desktop` | `~/Library/Application Support/app.legato.desktop` | `~/.local/share/app.legato.desktop` |
| Google session (webview cookies) | `%LOCALAPPDATA%\app.legato.desktop\EBWebView` | The system webview's own store | The system webview's own store |
| Secrets | Credential Manager | Keychain | Secret Service |

## Running and checking the app

Running it:

- `pnpm dev` resumes playback at launch and after every full reload (a store module changed: settings, player store),
  with sound: pause it, or stop the app while editing those files. Editing many files at once (the locales) can leave
  the player half reloaded: restart.
- A change in `src-tauri` or `crates/` restarts the app and cuts what runs in it. Interface files only hot-reload.
- Stopping it leaves Vite on port 5173 and `target\debug\legato.exe` running: stop those two by PID, never the installed
  app (`%LOCALAPPDATA%\Legato\legato.exe`). A second launch while one runs exits at once (single instance).
- Dev data that already passed a `DEFAULTS_VERSION` doesn't get a default changed under that same version.

**Two dev libraries under Claude desktop.** It is an MSIX package (`Claude_pzs8sxrjxfjjc`), so its Bash and PowerShell
tools see `%APPDATA%\app.legato.desktop.devbuild` at
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\…`, an old copy with other data. Its Terminal panel runs
outside the package, so a `pnpm dev` started there uses the true Roaming folder. To read what a running dev app holds,
run a read-only script from a Terminal tab (`process.env.APPDATA` is the true one there). File times stuck in the past,
or a `diagnostics.log` missing the latest lines, mean you are on the copy (it cost a long wrong diagnosis on 2026-10-31).

Checking it without touching the owner's running app:

- Interface alone: `.claude/launch.json` has `ui-vite` (starts Vite) and `ui-preview` (attaches to the one running). The
  page needs a fake Tauri: on Vite's origin, write `fetch('/')`'s HTML into a same-origin iframe, with
  `<base href="http://localhost:5173/">` and a script defining `window.__TAURI_INTERNALS__` before anything else
  (`metadata`, `transformCallback`, `convertFileSrc`, `invoke` answering `plugin:event|listen`, `library`
  `{tracks, playlists, orders}`, `not_found`, `sources_status`, `play_stats`, `[]` for lists). Settings › About also needs
  a full `cache_stats`. Fire events through the callback `transformCallback` kept. `site/demo` (branch in
  [handoff.md](notes/handoff.md)) has a fuller one.
- Reaching the stores: Vite serves modules by URL, so `import()` the URL listed in
  `performance.getEntriesByType('resource')` (after a hot reload it carries `?t=`), or you get a second instance.
- Real app: the `app` entry of `.claude/launch.json` opens WebView2's DevTools port 9333. Drive the page over CDP from a
  node script (`scripts/cdp.mjs`): `Page.captureScreenshot`, `Emulation.setEmulatedMedia` for light and dark,
  `Input.dispatchMouseEvent` for hover. Pause right after each reload and keep checking a few seconds: YouTube's late
  state can start it again.
- Screenshots by computer use: ask access for `C:\dev\music-app\target\debug\legato.exe`; the name "Legato" may map to the
  installed app.

Writing code:

- No formatter. The repository has no Prettier config and isn't Prettier-clean: never run it, write lines like the code
  around them (long single-line JSX is normal here).
- New interface text: its key in all 17 `ui/src/shared/i18n/locales/*.ts`. Keys use the typographic ’. A key you stop
  using goes too. `scripts/i18n-fill.mjs` builds a new language from `fr.ts`.
- A virtual list whose rows change kind needs `getItemKey` (Up next's headers overlapped rows without it).
- Text in the accent: `text-accent-ink` (darkened until AA). Selection `bg-line`, chips ink when picked (`LedChip`), LEDs ink.
- Read `pnpm check`'s real exit code (`pnpm check > log; echo $?`): a pipe hides it.

## Measuring: `pnpm bench`

`pnpm bench` builds the release app under its own identifier (`src-tauri/tauri.bench.conf.json`), fills a fresh data
folder with 10 000 local songs (`crates/core/examples/bench_data.rs`) and reads start time, RAM and CPU: paused, playing,
and 10 minutes in the tray. `--quick` is a short run. `pnpm bench --visualizer` measures the visualizer instead (below). The numbers, how they are taken and what they leave out are in
[performance.md](performance.md); a full run appends its row there. Windows only, and about 20 minutes of a PC left alone.
`scripts/cdp.mjs` is its small DevTools client; the E2E smoke test reuses it.

## Smoke test: `pnpm e2e`

`pnpm e2e` builds the app as a guest (`tauri build --debug --no-bundle --features e2e`, identifier
`app.legato.desktop.e2e`, `src-tauri/tauri.e2e.conf.json`, the exe copied to `target/e2e`) and walks a new user's first
minutes through its real window, over WebView2's DevTools port (`scripts/cdp.mjs`; how the port opens: below): the
welcome comes first, Add folder (three WAV songs the test writes, `e2e/wav.mjs`), the Songs page lists them, a song plays
3 s and the engine's position moves, the visualizer's frames come at about 60 a second, Pause freezes it and Play moves it again, the
visualizer turned on draws LED bars in Now Playing (a screenshot of the strip, and of V's full screen, must not be blank:
`e2e/png.mjs` decodes it) and Esc leaves, then Radial, VU needles and Spectrogram the same way (`10-radial.png` to
`12-spectrogram-full.png`; read them by eye after a change to a look), and the engine's own count (`viz_stats`) shows frames
coming while one is open and no worker left after it closes, a search (suggestions, YouTube, YouTube
Music and Apple, all answered by `e2e/mock.mjs` from `e2e/fixtures`) while the song plays on, a Deezer playlist link typed
in Add music (its progress toast, the playlist made with the one song found, the one not found said) and an Apple Music album
link pasted with Ctrl+V (Cancel makes nothing, then the full import), the window's Close with
"Keep running in the notification area" off (the app must end by itself, exit code 0), then the same data again: no
welcome, the library is still there. About 20 s once built. The diagnostics log says what started the deferred work at each launch
(`src-tauri/src/deferred.rs`): the walk fails when it was the 8 s timer, not the page's ready signal. A failure leaves screenshots, `failure.txt` (the step, the page's
text, what the mock saw, the diagnostics log) in `target/e2e/shots`; CI uploads them. `--repeat 5` walks five times on one
build, `--skip-build` reuses an unchanged build. The `e2e` job of `check.yml` runs it on Windows, the build and then the
walk as two steps, the walk held to 5 minutes. The port reaches WebView2 through `LEGATO_E2E_BROWSER_ARGS`, which only the
e2e build reads (`background::browser_args`): on GitHub's runner `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` never shows on the
browser's command line, with or without admin rights, while the same runtime (156.0.4314.50) takes it on a Windows 11 PC.
Why is unknown. `pnpm bench` runs on a PC and keeps that variable. When no page attaches, the walk prints the browser's
command line, the OS and the Edge policies. It blocks since 2026-11-01 (green on the 6 checks before): a failure turns
`check` red, and `release.yml` waits for a green `check`, so no beta goes out until it passes again.
Checked on 2026-10-30: with the click handler of the player's play button emptied, the walk fails at `pause-play`
("Pause did not pause"), exit code 1, screenshot and report left. Checked on 2026-10-31: with the Deezer link recogniser
(`deezerLink`) broken, the walk fails at `links` ("the page never showed Importing from Deezer… 0 of 2").

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
rest of the interface runs as when a person picks. Only the two data folders of `.e2e` are ever deleted as folders
(`e2eFolders`, like the bench's). `--shots` takes any folder, so a walk removes there just the files it writes, by exact
name (the numbered pictures, `FAIL-<step>.png`, `failure.txt`, `diagnostics.log`: `clearShots`) and never empties it.
Like the bench, it never touches the installed app (`identity.rs`).

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

Spotify's official API needs each user's own Client ID. Without one, public playlist links still import
(`crates/connectors/src/spotify_embed.rs`), and Connect Spotify brings in private playlists and Liked Songs
([playback.md](playback.md)).

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
| `lastfm` | The Last.fm session |
| `sync_key` | Sync Mode's key |

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
