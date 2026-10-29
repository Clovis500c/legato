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
- Mini player: on top of the right panel by default (`SidePanel.tsx`, user's pick 2026-10-29: the sidebar shows
  the library only), docked at the bottom of the sidebar (`SidebarPlayer.tsx`) or a floating card above the bar
  (`MiniPlayer.tsx`), Settings › Appearance › Mini player place. For YouTube it is always shown (the video must stay
  visible), even with the right panel hidden: the video fills a 200 px tall slot, YouTube's minimum (the 16:9 frame is
  wider, its sides cut); our controls never sit on top. For other sources it's optional.
  The sidebar one is a card tinted by the cover with the song's progress along its bottom; with vinyl covers (Settings ›
  Appearance) a song from another source shows as a record, its cover the label, turning at 33⅓ rpm while it plays
  (user's request 2026-10-22; `motion` off or reduced motion: still). YouTube keeps its video there.
- In-app drag and drop is pointer-driven (`shared/ui/drag.ts`): the window's file drop (audio files, QR codes) takes
  OS drags on Windows, so HTML5 drops inside the page never fire.

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
  the page drops them. Settings › Playback brings YouTube's controls back (next track). Subtitles:
  `unloadModule` captions / cc once per video unless Settings › Playback turns them on. YouTube's new embed player (2026-10-22) draws its own
  controls layer (`.ytPlayerControlsContainerHost`…): hidden the same way.
- One embed per run of YouTube tracks: the next video goes into the running player (`loadVideoById`), no reload.
- Any embed error but 100 (101 / 150 owner turned embedding off, 152 / 153 player configuration, 5…; widened
  2026-10-23, plus an embed that never starts), 2026-10-20: the same video plays from YouTube's own watch page, in a
  child webview of the main window placed exactly over the video slot (`src-tauri/src/ytwatch.rs`, Tauri multi-webview,
  `unstable` feature; the watch page can't be framed). `crates/shield/src/watch.js` hides everything around
  `#movie_player` and every overlay, fills the webview, stays muted until the app sends its volume, applies the app's
  crop, and reports state / time / duration / clicks as `musicapp-ytwatch:<json>` strings on WebView2's message
  channel (objects posted from that page never reach the host). Rust checks origin, shape and sizes, then emits
  `ytwatch` to the UI; commands go back as scripts built from fixed names and numbers. The page gets no app command
  (Tauri's IPC refuses it: no capability). Same store path as the embed (`watch.ts`): pause, seek, volume, fades,
  next, cover mode (webview hidden, still playing) and click-to-pause all work. Checked live by forcing error 150:
  switch at the same position, volume and crop applied, pause from the app and from a click.
- Watch page hardened (2026-10-23): it asks to play again while the app wants playing and YouTube leaves the video
  cued (autoplay off on the account), finds the player by class if `#movie_player` moves, gets the app's pause state when
  ready, and a page that hasn't started 15 s after opening counts as refused (cookie wall, sign-in page).
- Still unplayable on the watch page (region, age without a signed-in adult account, removed, private: playability
  status), or error 100 (removed): `alternative_videos` searches YouTube Music songs and videos for the same song (same
  cleaned title and length, any channel) and plays the first that works, else a clear message and the next song.
  When every song of the queue has failed in a row (none played since), playback stops with one message instead of
  looping on repeat (2026-10-28). Nothing is extracted: both are YouTube's own players.
- Now Playing Auto mode: frames `1.jpg` / `2.jpg` / `3.jpg` (25 / 50 / 75 %) compared at 32×24 (`still.ts`); nearly the
  same = still image upload = cover. Cover mode keeps the embed playing, transparent (user's choice, see plan).
- Fades between songs: volume × `fadeGain` (smoothstep), only on transitions that happen on their own; Spotify none.
  YouTube → YouTube overlap: as the fade out begins, the next song starts in a second embed; the old one plays on
  unseen as the tail (`tail` in the store), fading itself out until its video ends. Watch page, other sources: no overlap.
  The tail is then stopped, never unmounted: removing an embed while the other plays stalls the other one's video
  decoder for ~15 s with data buffered (measured 2026-10-28, also with `about:blank`). The two embeds swap roles at
  each overlap; the next song loads into the stopped one. In the tray the first one is born in a hidden page, where
  Chromium never starts its video: the page is held `visible` until the music moves (`hold_page`).
- Early endings (2026-10-28, Settings › Playback › Fades, on by default): videos that run on after their song
  (silence, a silent end screen). `live.js` listens (levels only when nothing else needs the sound: the element keeps
  its own sound) and reports `end` once the sound stayed under −50 LUFS for 2 s within the video's last 25 s. The
  playing song is over there (paused if nothing follows, so the silence never ends it twice); the overlap's tail is
  stopped. The end is kept per video (`player/ends.ts`, localStorage like `still.ts`, 3000 videos) and becomes the
  song's length on later plays: fades, overlap, Adaptive Sound's hold, times shown. Limit: 2 s of silence then a final
  part within the last 25 s ends at the silence. Local files: not done (gapless albums, hidden tracks).
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
| `Referer` forced through WebView2 `WebResourceRequested` (`https://app.legato.desktop`) | follows YouTube's rule for desktop apps to the letter (`Referer` header = app id over HTTPS) | Windows-only code (`webview2-com`), to redo per platform |
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
- Input: music folders (Settings › Accounts › Local files, watched: `src-tauri/src/folders.rs`), or audio files dropped on
  the window.
- Live processing chain on every file: see Live processing below.
- Limits: no opus; position obtained by polling, not events.

## Live processing (Adaptive Sound, moving cover; 2026-10-21)

Rule changed by the user (2026-10-20): the app may process **its own output, live**, for listening features. Still
never: downloading, extracting, recording or exporting a platform's audio, or touching DRM.

- **Local files and previews**: `crates/dsp` (`music-dsp`, pure Rust) in the native engine. `crates/player` `live.rs`
  wraps every decoded file in a rodio `Source` that runs blocks of 256 frames through the `Processor`: BS.1770 meter
  (K-weighting, momentary 400 ms, short-term 3 s, peak), Adaptive Sound gain, peak limiter. Settings and levels go
  through one shared `Control` (mutex + version, `try_lock` on the audio thread: it never waits). IPC `player_live`,
  `player_levels`.
- **YouTube**: `crates/shield` `live.js`, injected into the embed and the watch page. The video's sound is taken with
  `captureStream()`, the element is muted, and Chromium's own audio nodes play it: gain → limiter, plus a K-weighted
  analysis branch. Same formulas as the native chain. The page keeps its own mute (an instance `muted` property),
  the element's volume (the app's volume and fades) is applied in the gain. Any failure (sound blocked before a
  click, nothing captured yet) leaves the element its own sound: it is muted only once captured sound proves the capture works, and gets its sound back after 2 s of lost capture. Levels only (moving
  cover, early endings, no Adaptive Sound or edits): `listen`, analysers alone (Chromium pulls them unconnected), the
  element never muted, its sound untouched. Switching modes attaches again. Messages: embed
  `postMessage` to the app's origin only; watch page `musicapp-live:` strings checked in Rust (`ytwatch.rs`).
- **Spotify**: plays in Spotify's own app, out of reach. Shown as such under the volume.
- **Volume mixer** (2026-10-23): YouTube's sound plays in WebView2's own processes, so Windows listed it as "Microsoft
  Edge WebView2". `src-tauri/src/mixer.rs` gives our WebView2 audio sessions (only processes this app started) Music
  App's name, icon and grouping every 3 s. Label only: the sound is never taken out of the player (no extraction).
- **Adaptive Sound**: gain heads for `target − short-term loudness`, clamped −12..+9 dB, 2.5 s glide, held while the
  momentary loudness is under −45 LUFS (silence) or 10 dB under the short-term (the music falling away: a song's own
  fade-out, a stop), and while the app fades the song out (`ending`, sent when the fade out begins). The fades are the
  app's: before 2026-10-28 the gain rose ~5 dB under a fade out and the next song started from it, loud. A new song
  starts from the last one's gain; across the two YouTube embeds of an overlap the app sends it (`gain`, used once by
  the next track). Limiter (ceiling 0.97) only while boosting: off, the sound is bit-identical (test). Targets: Quiet
  −20, Normal −14, Loud −11 LUFS.
- **CPU** (2026-10-28): every recursive state (filters, reverb, echo, compressor, meter) puts values under −400 dB
  to 0. Decaying into denormal floats once the music stopped, the meter cost 1.4 s of CPU per minute of silence
  (21 ms from a clean start) and the reverb 3.3 s (77 ms); now ~35 and ~100 ms. Biquads clear both states together
  (one alone made the pair grow back). Adaptive Sound's target is worked out once per 256 frames, the gain still
  glides per frame: 600 s of music 1.43 s → 0.49 s of CPU.
- **Moving cover**: scale from the momentary loudness, up fast and down slow (`player/pulse.ts`), transform only,
  none with reduced motion or Animations off.
- UI: `player/live.ts` (settings out, levels in, only from what plays now), `liveSync.ts`, `AdaptiveBar.tsx`.
  Settings › Playback › Sound processing; "Process YouTube's sound" turns the YouTube side off.

## Live Editor (phase 4.1, 2026-10-21)

Edit the playing song live; written from scratch, Audacity's ideas as inspiration only (no code read or copied).

- **Order**: speed / tempo / pitch → EQ (bass shelf 100 Hz, 10 bands an octave apart: 32 Hz shelf, 64 Hz to 8k peaks, 16k shelf; older 5-band edits read onto them) →
  distortion → compressor → stereo width (M/S) → echo → reverb → 3D → balance → Adaptive Sound → limiter. Native: `crates/dsp`
  `chain.rs` + `stretch.rs`, run by `crates/player` `live.rs`. YouTube: the same graph in `live.js` from Chromium's
  nodes, built on the first edit (2026-10-28: Adaptive Sound alone ran its 144 nodes, two reverbs and an HRTF panner
  included, now 15 nodes), faded in over a direct path that then stays silent.
- **Speed** moves time and pitch together (slowed, nightcore), **tempo** only time, **pitch** only pitch.
  Native: WSOLA time stretch (Hann windows, 50 % overlap, normalized cross-correlation search) then a Catmull-Rom
  resampler; pitch alone = stretch by 1/p then resample by p. YouTube: `playbackRate` with `preservesPitch` for the
  timeline (the picture follows the sound), plus a pitch shifter made of two swept delay lines (AudioWorklets are
  blocked by YouTube's CSP). The song position published to the app is song time, not samples played.
- **Reverb**: Freeverb layout (8 damped combs, 4 allpasses, right side +23 samples). Wet level follows the room size
  so any mix stays within 1 dB of the dry song (test). **Echo**: feedback delay. **Compressor**: one amount (threshold
  −6..−30 dB, ratio 1..8, make-up gain).
- **3D sound**: Woodworth interaural delay, Brown–Duda head shadow, elevation tilt, distance (level and a small room).
  Turning (period 2–30 s) makes an "8D" song. YouTube: Chromium's HRTF panner. For headphones.
- **Limiter**: on whenever effects are on (a bass boost can clip with no gain from Adaptive Sound); untouched songs
  still pass bit for bit.
- **Saved**: numbers only (`edits` table, SQLite v9), never audio. Per song: `t:<track id>` (library), `yt:<video>`
  (recommendations), `f:<path>` (files opened outside the library). Several versions per song, one active (plays
  whenever the song does); presets have no song. The A / B switch keeps processing attached so it flips at once.
- **Export**: local files only, `crates/player` `export.rs`: the same chain offline into a new 16-bit WAV (TPDF
  dither), written as `.part` then renamed; refuses the original's path and anything but `.wav`; cancel removes the
  partial file. Never for YouTube, Spotify or Apple Music (their audio is never saved). Reverb tails are cut where the
  file ends.
- **Spotify**: plays in its own app, out of reach; the panel says so (settings stay saved for the song).

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
  a restricted account, and playback may break if YouTube changes its player. Settings › Shield turns blocking off.
