# Audio playback: prototypes and plan

Status on 2026-10-16. YouTube, local files and Apple Music previews: done and tested on Windows (WebView2). Spotify Connect: built and tested with mocks, not yet tried on a real Premium account.

## One queue for every source (phase 4)

- The queue lives in the UI player store (`ui/src/features/player/store.ts`): the list a track was started from, walked by next/prev.
- Each track plays through its best source (`sources.ts`): **local file, then full YouTube, then Apple Music 30 s preview**.
  Tracks with none of these are skipped.
- "Play via" in Now Playing switches the current track to another of its sources.
- Consecutive local files go to the engine as one run, so they stay gapless. When the run ends (`Status.ended`), the store moves on.
- Engine status lags commands: the store ignores statuses until the engine reports one of the paths it was just given.
- "Find full versions" (`find_versions`): for tracks that only preview (or don't play), one YouTube search each, within the daily
  budget of 100, cached for the session. Matching = ISRC, then title + artist + duration.

## One player for every source (2026-10-16)

- `Transport.tsx` (shuffle, previous, play, next, repeat) is the same in the bar, Now Playing and the mini player.
- Play order lives in the store (`order`, `queue.ts`): shuffle = current track first, the rest Fisher–Yates; repeat one
  replays on a natural end only (a manual Next still moves on). Gapless local runs are only built in list order without
  repeat one; turning shuffle or repeat one on mid-run sends `truncate`: the engine keeps the current file and stops the
  preloaded next one before its first sample (stop flag per source), then the store picks what's next.
- Now Playing sizes the video (16:9) or cover (square) to the space left with container query units, so the controls stay on
  screen at any window size. The background takes a flat tint from the cover (`ambient.ts`: canvas average weighted to
  colorful pixels; the tint is pushed darker or lighter until the theme's muted text keeps AA 4.5).
- Mini player: a card above the bar. For YouTube it is always shown (the video must stay visible): the iframe sits in the
  card's video slot, our controls below it, never on top. For other sources it's optional (Settings › Player).

## Media keys and the Windows media panel (2026-10-16)

- `src-tauri/src/media.rs`: SystemMediaTransportControls of the main window (`ISystemMediaTransportControlsInterop`),
  written on the `windows` crate already in use. One session for every source (YouTube, local, previews, Spotify).
- UI → `media_update` (`features/player/media.ts`, on track or play state change): title, artist, album, cover. Same
  track again = play state only. Cover bytes come from the art cache or the local file's tags, handed to Windows as an
  in-memory stream (Windows fetches nothing).
- Buttons and media keys → `media-key` event → store (`play` / `pause` only act if they change something; `stop` pauses).
- Checked live with a preview: Windows' session list shows title, artist, album and cover; play from the session
  resumes the app. Not done: timeline (position) in the panel.

## Cover art

- `tracks.art` holds an https URL; local files' covers are read from their tags on demand (`local::picture`).
- The UI loads `http://art.localhost/<encoded URL>` or `/local/<track id>` (Tauri `art` URI scheme, `src-tauri/src/art.rs`).
  Rust fetches only from i.ytimg.com, yt3.ggpht.com, *.googleusercontent.com, *.mzstatic.com and i.scdn.co (redirects too),
  keeps images in `art/` in the app data folder (300 MB, least recently used out first) and sends
  `Access-Control-Allow-Origin` so the cover tint can read pixels.

## Apple Music previews

- `itunes::preview` calls the public lookup API (`https://itunes.apple.com/lookup?id=…&country=…`) for `previewUrl` and `trackViewUrl`.
- Both URLs must be HTTPS on `*.apple.com` or `*.mzstatic.com` (`apple_url`), checked in Rust.
- The preview (AAC, about 1 MB) is downloaded by Rust and kept **in memory only** (`Command::PlayMemory`, decoded from a `Cursor`).
  Nothing is written to disk. The front end never touches the network.
- Apple's terms tie previews to promoting the store: Now Playing shows "Listen on Apple Music" (the `trackViewUrl`) next to every preview.
- Full Apple Music playback needs MusicKit, an Apple Developer account and DRM: not planned.

## YouTube: official embedded player

**Chosen setup**
- iframe `https://www.youtube.com/embed/<id>?enablejsapi=1&autoplay=1&playsinline=1&origin=<app origin>`
  with `referrerpolicy="strict-origin-when-cross-origin"` (`ui/src/features/player/youtube.ts`, `PlayerBar.tsx`).
- Bare by default: `controls=0&rel=0&iv_load_policy=3&fs=0&disablekb=1` and `pointer-events: none` on the iframe (no
  hover overlay; our controls drive it). `crates/shield/src/bare.js` hides every overlay YouTube draws (title, cued
  thumbnail, unmute, up next, end screen, error slate…) with an adopted sheet and a `<style>` element, both put back if
  the page drops them. Settings › Advanced brings YouTube's controls back (next track). Subtitles:
  `unloadModule` captions / cc once per video unless Advanced turns them on.
- One embed per run of YouTube tracks: the next video goes into the running player (`loadVideoById`), no reload.
- Error 100 / 101 / 150 (removed / owner turned embedding off): `alternative_videos` searches YouTube Music songs and
  videos for the same song (same cleaned title and length, any channel), plays the first that works, else skips. The
  block itself is not worked around (it would mean extracting the stream).
- Now Playing Auto mode: frames `1.jpg` / `2.jpg` / `3.jpg` (25 / 50 / 75 %) compared at 32×24 (`still.ts`); nearly the
  same = still image upload = cover. Cover mode keeps the embed playing, transparent (user's choice, see plan).
- Fades between songs: volume × `fadeGain` (smoothstep), only on transitions that happen on their own; Spotify none.
- Driven by `postMessage`, the protocol `iframe_api` uses internally (`listening`, `command`, `infoDelivery`, `onError`).
  We don't load `iframe_api`: a remote script in the app's origin would get access to Tauri IPC.
- CSP: only addition, `frame-src https://www.youtube.com`.
- YouTube rules: the player stays visible (356×200, minimum 200×200) except in Now Playing's Cover mode (user's
  choice, against the terms). No audio is extracted.

**Error 153 (no `Referer`): real measurement**
Debug build (`pnpm tauri build --debug --no-bundle`), origin `http://tauri.localhost`, app CSP, driven through the WebView2 DevTools protocol:

| iframe `referrerpolicy` | Result |
|---|---|
| `strict-origin-when-cross-origin` (chosen, also Chromium's default) | plays: state 1, time moving, pause, seek, end → next track |
| `no-referrer` | `onError 153` |

So the `Referer: http://tauri.localhost/` is what unlocks playback. On Windows, no Tauri setting or plugin is needed.
We still pin the policy on the iframe: a meta tag or header added later can't break it without us noticing.

**Options set aside (if YouTube gets stricter)**

| Option | Effect | Cost |
|---|---|---|
| `useHttpsScheme: true` (window) | origin `https://tauri.localhost` | origin changes, so the webview's localStorage, IndexedDB and cookies are lost for existing installs (we keep nothing there today); Windows and Android only |
| `Referer` forced through WebView2 `WebResourceRequested` (`https://dev.musicapp.desktop`) | follows YouTube's rule for desktop apps to the letter (`Referer` header = app id over HTTPS) | Windows-only code (`webview2-com`), to redo per platform |
| `tauri-plugin-localhost` | whole UI served on `http://localhost:PORT` | server open to every local process, IPC exposed to a plain http origin; discouraged by Tauri |
| Relay page on `127.0.0.1` | loopback `Referer` for the iframe only | small loopback server, double iframe, messages to relay |

**Open risks**
- macOS and Linux (untested): the `tauri://localhost` origin probably sends no `Referer`, so 153 is likely.
  Lead: the loopback relay page, which keeps the main window on the Tauri origin.
- The `postMessage` protocol is undocumented, but it has been stable for years and players like vidstack rely on it.
  If it breaks: load `iframe_api` in an isolated iframe with no IPC access.
- A video that can't be embedded returns error 101 or 150, shown in the app's alert.

## Local files: `crates/player`

- rodio 0.23 (symphonia decoding): mp3, flac, wav, ogg/vorbis, m4a/aac.
- The engine runs on a dedicated thread that owns the audio output (the cpal stream isn't `Send` on every platform).
  It receives commands over a channel and checks for track ends every 100 ms.
- Gapless: as soon as a track starts, the next one is appended to the rodio `Player`, which chains sources with no gap.
  The decoder strips encoder padding (gapless option on by default). The queue logic (`Queue`) has unit tests.
- An unreadable file is skipped and the error is shown.
- IPC: `player` (`play`, `toggle`, `seek`, `next`, `prev`, `volume`, `stop`) and `player_status`, polled 4 times a second by the PlayerBar.
- Input: music folders (Settings › Sources), or audio files dropped on the window.
- Limits: no opus; position obtained by polling, not events.

## Spotify Connect (built, untested on a real Premium account)

The Web Playback SDK inside the app is ruled out. We drive the official Spotify app (desktop, mobile or speaker) through **Spotify Connect**,
via the Web API Player endpoints. Audio comes out of the Spotify app; we only send commands.

**Prerequisites**
- Premium for the user: the `PUT /me/player/play` docs say "This API only works for users who have Spotify Premium".
- Premium for the Client ID owner: mandatory in dev mode since February 2026. The February 2026 migration guide touches no Player endpoint.
- New scopes `user-read-playback-state` and `user-modify-playback-state`, so a reconnect on first use.

**Endpoints**

| Need | Call |
|---|---|
| Pick the device | `GET /me/player/devices` |
| Transfer playback | `PUT /me/player` `{ device_ids: [id], play: false }` |
| Play a track or playlist | `PUT /me/player/play?device_id=…` `{ uris: ["spotify:track:…"] }` or `{ context_uri, offset: { position } }` |
| Transport | `PUT /me/player/pause`, `POST /me/player/next`, `POST /me/player/previous`, `PUT /me/player/seek?position_ms=`, `PUT /me/player/volume?volume_percent=` |
| State for the bar | `GET /me/player` (`is_playing`, `progress_ms`, `item`) |
| Queue | `POST /me/player/queue?uri=` |

**Integration (done)**
- Done: `Spotify::{devices, playback, command}` (mockito tests), IPC `spotify_player` / `spotify_playback`, a `spotify` `Via` after YouTube,
  "SP" in Play via (locked until Spotify is connected), polling every 1.5 s, end of track detected when Spotify moves on,
  volume debounced. Not done: position interpolation between polls, queue (`/me/player/queue`). Original notes:
- `crates/connectors/src/spotify.rs`: Player methods on `Spotify`, tested with mockito like the rest of the connector.
- `src-tauri`: a `spotify_player(cmd)` command modeled on `player`.
- UI: a `spotify` `Via` in the store routes commands to Spotify. Poll `GET /me/player` every 1 to 2 s
  and interpolate the position in between, to spare the quota.
- No active device: open `spotify:` with the opener, poll `/devices` for a few seconds, else show "Open Spotify on a device".
- Errors: `403` (Premium required) gives a clear message and a disabled button; `404` (no device) restarts the steps above;
  `429` honors `Retry-After`.
- Fallback without Premium: if the track also has a YouTube id (ISRC or title+artist matching), play it in the YouTube player.
  That's already the case today for any linked track.
- Real validation impossible without a Premium account: mockito tests first, then a try on a Premium account.

## Spotify without keys: prototype (2026-10-16)

- (a) Sign-in: Settings › Accounts › "Spotify web player" opens open.spotify.com in an app window; the user signs in on
  Spotify's page. Signed in = `sp_dc` cookie in the shared WebView2 profile (`src-tauri/src/spotify_web.rs`). No IPC for
  that window, and no ad blocking there (the shield only hooks the main window).
- (c) Playback in Spotify's official web player: WebView2 (Edge 155) reports both Widevine (`com.widevine.alpha`) and
  PlayReady through `requestMediaKeySystemAccess`. Real playback still needs the user's sign-in to confirm.
- (b) Reading playlists and Liked Songs with the web session: **not built**. The web player's access token now comes from
  `/api/token` with a TOTP whose secret is hidden in the player's code; getting it means rebuilding that scheme (defeating a
  technical protection) or capturing the token the official player fetches. Both need the user's go-ahead first.
- Chosen by the user (2026-10-16): no web-session import. **Public playlists and albums by link**, no account
  (`crates/connectors/src/spotify_embed.rs`): the official embed page (`open.spotify.com/embed/<kind>/<id>`) carries the
  list in its `__NEXT_DATA__` JSON (first 100 tracks). Each track is matched to YouTube Music (6 searches at a time,
  signed-in Google session) and plays through the YouTube embed. Saved as an imported Spotify playlist; importing again
  refreshes it. Paste the link anywhere (Ctrl+V) or in Add music.

## Ad shield (`crates/shield`) — user's choice, 2026-10-16

- Brave's engine (`adblock` 0.13, MPL-2.0 licence) on EasyList and EasyPrivacy. Lists are downloaded by Rust, cached
  4 days in the app data folder, and never bundled in the binary. Built-in rules (Google and YouTube ad servers)
  cover the first offline launch.
- WebView2: one `WebResourceRequested` on `*`, every source kind (`ICoreWebView2_22`, iframes included). A blocked request
  gets an empty 403 response.
- YouTube player: `crates/shield/src/youtube.js` is injected in every frame (only YouTube frames act). It removes
  `adPlacements`, `adSlots`, `playerAds` and `adBreakHeartbeatParams` from the player data ("json-prune" approach, written from scratch).
- Checked in the built app: 4 requests blocked during an embedded video, playback continues, and the script is active in the YouTube
  iframe.
- **Risk accepted by the user**: YouTube API terms forbid blocking ads in the embedded player. We risk
  a revoked API key, and playback may break if YouTube changes its player. Settings › Shield turns blocking off.
