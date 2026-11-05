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
  resumes the app. Timeline: position and length go with each play state (`set_state`, Windows moves the bar while
  playing); a seek in the panel comes back as `media-seek`.

## Headphones unplugged (2026-11-01)

- `src-tauri/src/unplug.rs`: Windows' endpoint notifications (`IMMNotificationClient`, registered once on its own
  thread). The default output (console role: what cpal and WebView2 open) leaving, unplugged, turned off or disabled,
  → `audio-output-lost`. Windows may move the default to the speakers before it says the old one left: the device that
  was the default up to 2 s before counts too. Told once per device until it comes back. Another device leaving, or a
  default picked by hand, pauses nothing.
- `features/player/unplug.ts`: setting `pauseOnUnplug` (Settings › Playback › Headphones and calls, on by default) and
  something playing → `pauseNow` (no pause fade: not a moment out of the speakers), notice with Play.
- A new default (picked by hand, or the speakers taking over) → engine `Command::Reopen`: the playing file reloaded
  on the new device at the same place, paused or not (nothing playing: the next play opens it). WebView2 follows the
  default on its own.
- Calls: the same thread registers for the default output's ducking notifications (`IAudioVolumeDuckNotification`,
  every session's: none of ours changes) and moves them with the default. A communications stream opening (Teams,
  Skype) → `audio-call` true, closing → false. Setting `pauseOnCall` (off by default: Windows already lowers the
  music): paused with the pause fade, played on at the end unless the music was played or changed meanwhile.
  Unchecked: whether Windows still says it with its Communications setting on Do nothing, or for a call on another
  device.
- Limit: headphones and speakers on one endpoint (Realtek jack retasking) change no endpoint, so no event.

## Smart shuffle (2026-11-01)

`features/player/shuffle.ts`, on by default (Settings › Playback › Up next; off: plain Fisher–Yates). Each artist
(first credited, as Albums group them) gets a random offset and one song every 1/k of the way with a little jitter;
a pass then swaps in a song a little further on wherever an artist plays twice in a row while someone else is left.
Songs started in the last 24 h (play stats) come after all the others, spread the same way.

## Cover art

- `tracks.art` holds an https URL; local files' covers are read from their tags on demand (`local::picture`).
- The UI loads `http://art.localhost/<encoded URL>` or `/local/<track id>` (Tauri `art` URI scheme, `src-tauri/src/art.rs`).
  Rust fetches only from i.ytimg.com, yt3.ggpht.com, *.googleusercontent.com, *.mzstatic.com and i.scdn.co (redirects too),
  keeps images in `art/` in the app data folder (500 MB by default, a setting; least recently used out first, on a
  background thread) with 64 / 256 / 600 px thumbnails cut once (`?s=64`, list covers ask for the smallest that fits) and sends
  `Access-Control-Allow-Origin` so the cover tint can read pixels.
- **Cover display** (2026-11-02, `coverFull.ts`, `CoverScreen.tsx`, lazy): C (rebindable) or the button beside Karaoke in
  Now Playing. The window full screen (`holdFullscreen`, like the visualizer's), the cover huge (`min(82vh, 70vw)`) over
  its own blurred copy (`Backdrop`, at least 40 px and 45 % veil), title, artist and progress on its lower part, white on
  a dark fade (any cover, any theme). Right-click: the player's basics, the clock (setting `coverClock`, off; the time and
  the day as the interface's language writes them, `coverClock.ts`, sized to the room beside or above the cover so it
  never covers it). Esc or a double click leaves (`vizFullKeys`); while it is up F, K, V, search and navigation wait.
  The pointer and the Leave button hide after 2.5 s still; a screen wake lock keeps the display on while it is open
  (none or refused: the display sleeps as usual). Now Playing's visualizer rests under it; the native watch page hides.

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
  cleaned title and length, any channel; signed out, its public catalog) and plays the first that works, else a clear
  message and the next song.
  When every song of the queue has failed in a row (none played since), playback stops with one message instead of
  looping on repeat (2026-10-28). Nothing is extracted: both are YouTube's own players.
- No network (2026-10-30; Windows says so: `navigator.onLine` false, `shared/online.ts`): a video that won't start or
  errors isn't refused. Nothing is blocked (the refused list is kept between launches) or skipped: playback pauses with
  one message, and the song starts over in a new embed (`frameKey`) once the network is back (`waitForNetwork` in
  `store.ts`). Before, a dropped Wi-Fi marked every song it reached as refused, for good. The top bar shows Offline.
- Google's limit (2026-11-01): while Google limits the PC's address (many requests from it, an import's searches), its
  "Sorry…" page answers some of the embed's player requests (403 after about 7 s, or 429), and the embed then waits for
  good, black and silent, with no event. `crates/shield/src/refused.js`, in every frame, reads the embed's resource
  timings (YouTube's fetch untouched) and posts `{ musicApp: 'refused' }` to the app: the video is loaded again once, at
  once; refused again, playback stops with one message. Nothing is blocked or searched and no watch page: the video
  isn't to blame, and the watch page is Google's too. The clock waits for a new song's first report (`Progress.tsx`).
- The stuck check arms when the video is set, not only when the play count moves: `playAt` counts the play before it
  sets what plays, so the first YouTube song of a session (or after a file) was never watched (2026-10-30).
- Now Playing Auto mode: frames `1.jpg` / `2.jpg` / `3.jpg` (25 / 50 / 75 %) compared at 32×24 (`still.ts`); nearly the
  same = still image upload = cover. Cover mode keeps the embed playing, transparent (user's choice, see plan).
- Fades between songs: volume × `fadeGain` (smoothstep), only on transitions that happen on their own; Spotify none.
  YouTube → YouTube overlap: as the fade out begins, the next song starts in a second embed; the old one plays on
  unseen as the tail (`tail` in the store), fading out to its song's end (`tail.end`, where the overlap was timed), then
  stopped there. Watch page, other sources: no overlap.
  No fade within an album (Settings › Playback, on by default): the next song right after this one in the list, same
  album and first artist (`albumGoesOn`), plays on with no fade out, overlap or fade in (`songFade` in the store), so a
  live or continuous album never dips. No track numbers are kept: the list's order stands for the album's; a compilation
  (artists differ) still fades.
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
  part within the last 25 s ends at the silence. Local files: see Skip silence below.
- Skip non-music parts (2026-10-31, Settings › Playback, off by default: a new third party, so the user opts in).
  SponsorBlock's community segments, category `music_offtopic`, action `skip` only. `crates/connectors/src/sponsorblock.rs`:
  `GET sponsor.ajay.app/api/skipSegments/{first 4 hex of the id's SHA-256}`, the answer holds a dozen videos and is
  filtered by the full id here, so the id never leaves the PC (4 s timeout; 404 = none; parts under a second dropped).
  `sponsor_segments` (`src-tauri/src/sponsor.rs`) caches per video in SQLite `sponsor` (rows older than a month dropped), the empty answer too, a week.
  The store (`player/store.ts` `skipPart`, rules in `player/sponsor.ts`) seeks past a part the play just reached with the
  official player's `seekTo`, once per part and play: a seek (back or forward) into it stays there (`landed`: a move of
  over 4 s between two reports), a resume inside it never skips, data late by a few seconds still catches an intro.
  A skipped intro or silence moves where the fade in counts from (`fadeFrom` in the store). Notice "Skipped a non-music part (0:24) · Undo": Undo seeks to the
  part's start and the video is left alone from then on (localStorage `sponsor-undone`). Marks under the progress bar
  (`PartMarks`). A last part running to the video's end is where the music ends: offered to `ends.ts`, so the fade, the
  overlap and the next song start there. A failure or no answer: no skip, the song never waits for it.
- Driven by `postMessage`, the protocol `iframe_api` uses internally (`listening`, `command`, `infoDelivery`, `onError`).
  We don't load `iframe_api`: a remote script in the app's origin would get access to Tauri IPC. `infoDelivery` sends
  what changed only: a video's `duration` comes once, as it loads (8 of 148 reports, measured 2026-10-30), so the store
  keeps it per song. Read from each report, the overlap's tail never faded (the old song played on at full volume under
  the next one) and an early end was only ever reached through the overlap.
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
- Skip silence (2026-10-31, Settings › Playback, off by default: hidden tracks and gapless albums mean their silence).
  `crates/player/src/silence.rs` measures a file: RMS over 20 ms windows under −60 dBFS is silence; the music starts 50 ms
  before the first loud window, ends 200 ms after the last; under 0.3 s at the start or 1.5 s at the end is left alone.
  Measured when a song is about to play, never at scan time: `local_prepare` (`src-tauri/src/prepare.rs`) looks up
  SQLite `silence` (by path and modified time, `Library::cached_silence`; the newest 20 000 rows kept), else finds the
  start of the playing file fast (the scan stops at the first loud window, 30 s of decoding at most), tells the engine (`Command::Trims`), and decodes the whole file once in the background for
  the end (4 files ahead per call, again when the gapless run moves on). Play waits 400 ms for the first scan at most;
  one that comes later still makes the engine seek past the silence if the song is inside it. The engine seeks past the start when a song
  begins (also at each gapless hand-over) and reports `trim_end_ms`; the front end offers it to `ends.ts` as
  `local:<path>`, so the fade and the hand-over to the next song use the same early-end path as a video's, and a
  song past its end goes to the next one (a normal `step`, so no gapless chain across a trimmed end). Nothing
  measured (failed, not yet): the song plays as it is. YouTube: `live.js` reports `lead` when the music began after 2 s
  or more of silence from the video's very start; kept per video (`ends.ts` `song-starts`), the next play seeks there
  once (never a loop). The first play of a video can't know.
- Volume levelling (2026-11-01, Settings › Playback › Sound processing: Off / Song / Album, off by default: it changes
  how the files sound). Each local file gets a gain to -14 LUFS, the level Spotify, YouTube and Tidal play at, so a
  file sits with the streamed songs around it (ReplayGain's own -18 would leave it 4 dB quieter). From its ReplayGain
  tags when a scanner wrote them (`music_core::local::replay_gain`: ID3 TXXX in any case, Vorbis, MP4 freeform, APE;
  tag gain + 4 dB), else from its loudness measured once: `music_dsp::loudness` (BS.1770-4 integrated loudness with the
  standard's own K-weighting, 400 ms blocks every 100 ms, gates at -70 LUFS and 10 LU under; mono counts as both
  speakers), run in the same background decode as the silence scan (`music_player::level::analyse`), cached in SQLite
  `loudness` by path and modified time. Album: the album gain of the tags, else the song's own (a measure has no album).
  A boost stops before the peak passes -1 dBFS (never turned into a cut) and at +12 dB. `local_prepare` gets both jobs:
  tags and caches answer before the song starts (play waits 400 ms at most), the rest after the background decode.
  The engine (`Command::Level`, `Command::Gains`) gives each loaded file an atomic multiplier that `live.rs` applies
  to decoded samples, before the live chain (its limiter sees the result): a song starts at its gain; a change glides
  (0.15 s time constant). A gain that comes for the playing song after its first 3 s waits for the next play, unless
  the setting moved in the last 5 s (so a first, untagged play is levelled only if its measure is quick). Unseen: real
  tagged files from foobar2000 or MusicBee, a long file's measure time, how it sits next to YouTube by ear.
- **Song's shape on the seek bar** (2026-11-05, Settings › Appearance › Progress bar › Song's shape): a local song's
  loudness along it, measured in the same background decode (`music_player::shape`: the RMS of 50 ms windows, 400
  points, -36 to 0 dBFS as 0 to 255), cached in SQLite `waveform` by path and modified time (schema 17).
  `local_waveform` answers from the cache, else decodes the file once (`prepare.rs` `measure`: one decode per file at a
  time, a second ask waits for it and reads the cache; the decode keeps the silences and the loudness too). The seek
  bar (`Progress.tsx`, `seekShape.ts` pure and tested) draws 120 bars, the loudest point under each, the played part
  in ink over the rest in the line's colour; the bar's own line and the wave hidden, the thumb kept. Streams and files
  not measured yet show the wave (Wavy). Local files only: a stream's audio is never taken for it. Seen over the demo
  (its fake engine sends a made-up shape); not measured on real files in the app, nor timed on a long one.

## Live processing (Adaptive Sound, moving cover; 2026-10-21)

Rule changed by the user (2026-10-20): the app may process **its own output, live**, for listening features. Still
never: downloading, extracting, recording or exporting a platform's audio, or touching DRM.

- **Local files and previews**: `crates/dsp` (`music-dsp`, pure Rust) in the native engine. `crates/player` `live.rs`
  wraps every decoded file in a rodio `Source` that runs blocks of 256 frames through the `Processor`: BS.1770 meter
  (K-weighting, momentary 400 ms, short-term 3 s, true peak), Adaptive Sound gain, peak limiter. Settings and levels go
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
- **Visualizer data, 60 Hz** (Visualizer v2 step 1, 2026-10-31; spec `docs/notes/ideas/visualizer.md`). 61 bands of 1/6
  octave (base 10, 19.95 Hz to 19.95 kHz), left and right, plus left / right rms and peak, in a packed frame: 8 bytes
  (version 1, band count, flags, 1 reserved, rms L R, peak L R) + 61 bands L + 61 bands R, every dB value one byte, `(dB + 120)
  · 2` (0.5 dB steps, floor -120). A sine of amplitude 1 reads 0 dB in its band; bands are energy sums (Parseval), so
  the window does not matter for noise: pink noise reads flat as measured, white noise rises 3 dB an octave (both
  twins' tests, 256 random-phase takes averaged, from 450 Hz up; the tilt weighting makes pink noise rise). Bands narrower than 3 bins (under ~320 Hz at 48 kHz) widen to 3 bins around
  their center: a sine reads right (within 0.5 dB), the neighbours of the lowest bands read nearly as much (the 4096
  FFT cannot split a 2.4 Hz band; a longer window for the lows is the fix if bass detail ever matters), and noise reads
  a few dB high there. Both twins have this mapping: pure `BandMap` in `crates/dsp/src/viz.rs`, `vizMap` between
  `viz:begin` and `viz:end` in `live.js`; `crates/dsp/fixtures/viz.json` is the shared signals with what Rust reads
  (`UPDATE_VIZ_FIXTURE=1 cargo test -p music-dsp viz_fixture` rewrites it), `crates/shield/src/viz.test.ts` runs the
  JS block on them through a model of Chromium's analyser (checked once against the real one in WebView2's engine: a
  sine reads 0.00 dB). Twins agree within 2 dB on the bands that carry sound from 450 Hz up, 4 dB below (Blackman's
  lobe is wider than Hann's, and sines closer than a lobe interfere differently).
  - **Twelfths** (2026-11-04, Settings › Playback › Visualizer bands › 1/12 octave): 121 bands on the same scale (every
    other one a sixth's center), from a window twice as long in both twins (8192 points: `Bands::Twelfth`, live.js
    `VIZ_N_FINE`), so they widen to 3 bins under the same ~320 Hz; the fixture holds them too (`fineLeft`,
    `fineRight`). A frame carries its count in byte 1 (250 bytes; the watch page's text up to 400 characters); rms
    stays over the last 4096 samples, so the needles read alike. `viz_start(fine)` and the live wish's `fine` ask for
    them: `vizFrames.ts` `setAsk` starts the engine's stream again, live.js makes its analysers again, and the scene
    skips a frame of the other size while the switch goes through. Not tried on real music yet.
  - **Wave blocks** (2026-11-04, for the Oscilloscope): flag 1 in byte 2 adds, after the bands, the last 1024 samples
    of each side averaged in pairs (512 a side, 24 kHz, about 21 ms) as i16 little-endian (32767 = full scale): 2 KB
    more a frame, and the watch page's text up to 3100 characters (`ok_viz`). Only when asked: `viz_start(wave)`
    (`Pump::waves`, `viz::wave_of`) and the live wish's `wave` (live.js `vizWave` after each read of the analysers'
    time data); `vizFrames.ts` `setAsk({ fine, wave })` starts the engine's stream again, as for twelfths.
  - **Native**: hann 4096-point FFT (8192 in twelfths; `realfft`), hop = rate / 60, any sample rate (44.1 and 96 kHz tested). The audio
    thread only copies: `Processor::process` pushes its output (as heard: after gain and limiter, before the volume
    knob) into `tap.rs`, a ring of atomics, when `Tap::listen()` has a listener (one relaxed load otherwise; no lock, no
    allocation). The FFT runs in `src-tauri/src/viz.rs`: a worker thread alive only between `viz_start(frames)` and
    `viz_stop` (also a page reload, `on_page_load`, and a failed send; a new page claims the stream with `viz_page(id)` at start-up and a `viz_start` still in flight from the page before, carrying the old id, is dropped), `viz::Pump` every ~16.7 ms: a frame when new
    audio came, one silent frame after ~100 ms of no new audio or digital silence, then nothing (a third of the
    wake-ups while idle). Frames go over a Tauri `Channel<InvokeResponseBody>` as raw bytes. Where the device hands
    sound over in bursts the rate is that of the bursts (the e2e build: every 20 ms, 50 a second).
  - **YouTube**: `live.js` `vizStart` (only while `settings.viz`): a second pair of analysers at fftSize 4096 (8192 in twelfths) behind a
    ChannelSplitter, made then and dropped when it stops, so the chain costs nothing more with no visualizer; the older
    2048 pair keeps feeding the loudness. A 16 ms timer sends the same frame as base64 text
    (`{viz}` in the report, by the existing postMessage path, or the watch page's `musicapp-live:` string, checked in
    `ytwatch.rs`), the silent frame once after ~100 ms of pause or silence.
  - **Front end**: `features/player/vizFrames.ts`: `viz.subscribe(fn)` gives frames from whichever twin plays, same shape
    (`vizUnpack.ts`, pure), `viz.latest()` the newest as it came; the first subscriber opens the channel and raises the
    live wish `viz` (YouTube's 60 Hz), the last one closes both. The renderer below is the subscriber.
  - **Retired in step 2** (2026-10-31): the 16 band-passes (`spectrum.rs`), `Levels::bands`, `Live::bands`,
    `live.js` `bands()`, `LiveLevels.bands`, the `bands` wish and the old DOM bars (`bars.ts`).
- **Visualizer renderer** (Visualizer v2 step 2, 2026-10-31). One canvas drawn by a Web Worker on an `OffscreenCanvas`
  (Canvas 2D): `VizCanvas.tsx` (page side: makes the canvas and the worker, sizes it with `devicePixelRatio`, reads the
  theme's text colour where it is drawn, hands the frames over), `vizWorker.ts` (the loop), `vizPaint.ts` (drawing),
  `vizScene.ts` (bands folded into columns, ballistics, flash limiter), pure and tested: `ledBars.ts` (level up fast and
  down slowly, peak cap held 0.5 s then falling with gravity), `flash.ts`, `vizDraw.ts` (columns, LED rows, wave path).
  The worker is Vite's (`new Worker(new URL(...), { type: 'module' })`, its own chunk); the CSP has no `worker-src`, so
  `default-src 'self'` covers it: nothing changed there (checked in the e2e build, which draws).
  - **Only while seen**: frames and the worker's loop run when the page is visible (`visibilityState`: the tray hides the
    webview, `background.rs` `set_visible(false)`), the element intersects the viewport (IntersectionObserver), the
    caller shows it (not the strip while the full screen is up) and the song plays. A paused song gets one `silence`
    message: the bars fall, the loop stops at rest (all levels and caps under 0.002); `run: false` stops it outright.
    No `requestAnimationFrame` loop, no subscription, no engine thread then, so nothing keeps the tray's suspend from
    coming. Main thread cost: a `postMessage` of two small arrays per frame; the rAF intervals of the page read the same
    with the strip on and off (4.17 ms mean, 4.3 ms p95, the debug e2e build).
  - **Looks**: `led` (default; segments, lit ones brighter towards the top, cap segment white; sprites cached per size
    and colour, a few dozen `drawImage` per frame), and the four older ones ported to the canvas, `bars`, `mirror`,
    `peaks`, `wave`. One column per band down to 5 CSS px wide, fewer in narrow boxes (each takes the loudest of its
    bands). Both sides become one by power. Height = -78 dB (nothing) to -10 dB (full). Colour: the theme's text colour
    with an opacity per shade (never the accent, which is for playback), read from where it is drawn (Now Playing
    tints it with the cover). A saved `bars` look moves to `led` once (`DEFAULTS_VERSION` 9); the other looks stay.
  - **Weighting** (Settings › Playback › Visualizer weighting, or the visualizer's right-click, 2026-11-02;
    `vizWeigh.ts`, pure): dB added to each band before the columns, in the worker's scene. As measured (default: the
    bands are energies, pink noise reads flat, so music's lows stand taller), +3 dB per octave around 1 kHz, IEC
    A-weighting or ITU-R 468 (both 0 dB at 1 kHz). Over the demo's frames the tilt took the low third of the bars from
    27 % lit to 18 % and the high third from 20 % to 22 %, the middle unchanged; not judged by eye on real music yet.
  - **Colour** (Settings › Playback › Visualizer color, or the right-click, 2026-11-02): the text colour where it is
    drawn (default, as above), the theme's accent, or the playing cover's hue made vivid (`ambient.ts` `vivid`: its
    average colour's hue, saturation 0.5 to 0.8, lightness moved until it reads 3:1 on the theme's background; a grey
    cover keeps the text colour). `VizCanvas.tsx` sends it as the `ink` of the `look` message: the worker is unchanged.
  - **Gradient** (Settings › Playback › Visualizer gradient, or the right-click, 2026-11-04; none by default): colours
    laid over the bars after they are drawn (`source-atop`: their shapes and opacities, the gradient's colours), one
    `fillRect` a frame. `vizStops.ts` (page side) picks the colours: by level, the visualizer's colour to half height,
    amber, the alarm red at the top; along frequency, a seven-hue prism, red lows to violet highs; amber and the prism
    made 3:1 on the background. `vizFill.ts` (worker side, pure) lays them per look: bottom up, the mirror from the
    middle out, the ring from the cover out (radial) or clockwise from the bottom (conic). VU needles and the
    spectrogram keep their own colours.
  - **Bands, floor, scales** (Settings › Playback › Visualizer bands and Visualizer reflection, or the right-click,
    2026-11-04): 1/6 octave as the frames carry it (61), folded into 1/3 octave (31: `vizBands.ts` `toThirds`, powers,
    a sixth and half of each neighbour, the end bands scaled so a flat spectrum stays flat), after the weighing, or the
    twelfths' own frames (121, above; the weighing per twelfth); every
    look but the needles. The reflection (off by default): LED, bars, peaks and wave stand on the top 76 % of the box,
    the canvas copies that part upside down below at 40 % and wipes it out toward the bottom (`destination-out`). The
    pointer over a visualizer at least 120 px high: frequency marks along the top (50 Hz to 10 kHz, `freqAt`) and a
    dB grid (−20, −40, −60) on the right, not for the mirror; `hover` messages to the worker.
  - **Behind Now Playing** (Settings › Playback › Visualizer behind Now Playing, 2026-11-04, off by default):
    `VizBackdrop` in `Visualizer.tsx`, a second canvas across the bottom half of Now Playing at 20 % behind everything
    (`-z-10`, no pointer events), the look picked (bars for Radial); quiet under a full screen like the strip.
  - **In the mini player** (Settings › Playback › Visualizer in the mini player, 2026-11-04, off by default): a 24 px
    strip under the song, floating, in the right panel or in the sidebar (`MiniViz.tsx`, a shell file: it loads
    `MiniStrip` from Now Playing's chunk by `lazy` only once shown); no pointer events, quiet under Now Playing.
  - **On the streaming overlay** (Settings › Playback › Visualizer on the overlay, 2026-11-05, off by default, this
    PC's own): 31 bars (thirds of an octave, weighed as the visualizer, `overlayBars.ts`) under the song on the OBS
    page (`overlay.html`, its own ballistics, the bars in `.viz`'s colour for Custom CSS). Measured only while a page
    reads them: the page opens `/frames` (server-sent events, this PC only, two at once) while `/state` says `viz`; the
    server asks the interface (`overlay-viz` events) and `overlayViz.ts` subscribes to the frames, 30 bars a second at
    most to `overlay_bars`, until it answers that no page reads (the last one gone, or the setting off). The app's own
    visualizer can stay off; YouTube's bars need its sound processing on, as the visualizer's. Checked by a socket test
    and over a stand-in server with made-up bars (moving, at rest when paused, hidden and back); not in OBS itself.
  - **Curve** (a look, 2026-11-04): left and right as two smooth lines (`wavePath`) with a soft glow (`shadowBlur`,
    none with reduced motion) and faint areas, left in the visualizer's colour, right in the accent (the text colour
    when the visualizer is the accent: `ink2`, `secondOf` in `VizCanvas.tsx`); each side its own scene (`sceneR`).
  - **Loudness meter** (a look, 2026-11-04): EBU R128 numbers of the song as heard, from the levels Adaptive Sound
    already measures, not the frames: the song's own loudness after the Live Editor, before Adaptive Sound's gain and
    the volume. `loudFeed.ts` subscribes to `useLive` while a meter is drawn and the song plays (its count asks
    `liveSync.ts` for the levels: the native poll, or YouTube's frame listening), one count per song whichever view
    shows it, started over at a new song. `vizLoud.ts` (pure, tested) takes one momentary value per 100 ms of play
    (paused: shown, not counted; a gap counts 250 ms at most): short-term = the last 3 s of them, integrated = BS.1770's
    gates (-70 LUFS, then 10 LU under the mean), loudness range = EBU Tech 3342 (short-term values, -70 then 20 LU
    under, 10th to 95th percentile), histograms of 0.1 LU. The worker draws a picture per update, then rests: in the
    strip three bars, M S I, with their numbers; 120 px high and more, the words, the true peak (now, and a mark at the
    song's highest, in the alarm colour over −1 dBTP, EBU R128's ceiling), a −48 to 0 scale and the range.
    Approximations: the engine's momentary is a 400 ms exponential mean (smoother than the standard's window), and the
    integrated covers what the meter heard of the song. The backdrop and the mini player show bars instead.
  - **Oscilloscope** (a look, 2026-11-04): the wave blocks as one side (the mean of both), 256 samples (10.7 ms) across
    the box from a rising zero crossing of their smoothed shape (`vizScope.ts` `trigger`, 9 samples: the low end sets
    the period, hiss does not trip it; none in the first half of the block: from its start), so a steady note stands
    still; full scale at the edges, the visualizer's colour, no gradient, reflection or scales. Phosphor afterglow: the
    canvas is not cleared while sound comes, its alpha cut each frame (`destination-out`, a 50 ms time constant, three
    times it with reduced motion); at rest the last 8-bit traces go. `liveSync.ts` asks for the wave blocks only
    while it is the look. Seen over the demo (a 110 Hz note); not on real music.
  - **Vectorscope** (a look, 2026-11-04): a goniometer of the same blocks (`vizVector.ts`, pure, tested): each sample
    pair a point, side (R − L) / 2 across and mid (L + R) / 2 up, so a mono sound stands as a vertical line, one side
    alone leans 45°, opposite phases lie flat, and full scale draws the square's diamond (|x| + |y| is the larger
    side), never past it. Faint guides: the diamond, mid and side, left and right. The points fade like the scope's
    trace, in a canvas of their own so the guides and the meter stay crisp. The correlation meter under it (beside it
    under 120 px high: the strip under the cover): Σ L·R / √(Σ L² · Σ R²) over each block, eased over 300 ms, −1 to +1
    from the middle, in the alarm colour below 0 (what a mono mix loses); 0 when one side is silent, held through
    silence. The backdrop and the mini player show bars. Seen over the demo (its fifth harmonic differs in phase
    between the sides), full screen and in the strip; not on real music.
  - **True peak** (2026-11-04): BS.1770-4 annex 2 in both twins' meters, so the levels' `peak` is a true peak: the
    standard's 48-tap filter upsamples 4x (4 phases of 12 taps, its table digit for digit: passband ±0.1 dB to 20 kHz,
    −40 dB from 28 kHz), the highest |value| of the 4 points and the sample itself (never under the sample peak, as
    libebur128 reads it). Native: `meter.rs` `Oversampler` per channel, sample by sample (48 multiply-adds a sample on
    the audio thread). YouTube: live.js `truePeak` (`tp:begin` … `tp:end`, `truepeak.test.ts`, which also checks
    its table against the Rust one) over each 2048-sample read of the raw pair, every 33 ms. A quarter-rate sine 45° off
    reads its crest (samples at 0.707 of it) within 0.5 %; a full-scale one shows an intersample over (+3 dB).
  - **Beats** (2026-11-04): `vizBeat.ts` (pure, tested), in the worker, from the frames every look already gets (both
    sides' bands averaged). Onsets by spectral flux: the rise in dB since the last frame of the lows (40 to 160 Hz,
    kicks) plus half that of the mids (160 Hz to 2.5 kHz, snares), rises only; an onset when it passes 1.5 times its
    mean over the last half second plus 1.5 dB (hiss never does), 100 ms after the last at least, none in the first
    quarter second. Tempo: the autocorrelation of that strength over the last 8 s (resampled at 60 Hz), 60 to 200 BPM,
    weighted toward 120 (a log-Gaussian 0.9 octave wide) so a doubled or halved tempo loses, the peak refined by a
    parabola; none before 3 s. Used: the Radial ring steps out 4 % on an onset and settles over 120 ms, not with
    reduced motion. The tempo is not shown yet. Tested on click tracks (120, 93 and 128 BPM, in sixths and twelfths,
    frames 8 ms uneven: every click within a frame, the tempo within 2 BPM, nothing in hiss); the demo's frames give 19
    onsets in 10 s, on its beats, and 119.9 BPM. The ring's step not watched moving; not on real music.
  - **Particles** (a look, 2026-11-05): `vizParticles.ts` (pure, tested): soft dots in the cover's colours burst from
    the middle on each kick (Beats, above), more and faster for a stronger one, at most 3 bursts a second whatever the
    tempo; they drift with the mids along a slow swirl, slow down and fade over 1.2 to 3 s. A trickle in proportion to
    the level keeps a song without kicks moving. At most 900 dots in a full HD box, fewer in a smaller one (by area, 60
    in the strip), smaller by the root of its size, a burst's a third bigger. Colours: `coverPalette.ts` (pure,
    tested), the cover's colourful pixels by hue in 12 slices, up to 4, the most present first, each made vivid for
    the theme (`vivid`); the visualizer's colour for a grey cover. Light that adds up on a dark theme, plain on a light
    one. Full screen: over the cover blurred (Now Playing's backdrop, at least 40 px of blur and a 45 % veil, drifting
    unless reduced motion). Reduced motion: no bursts, half the trickle, a slower drift. The backdrop and the mini
    player show bars. Canvas 2D sprites, not GPU particles: 900 at 30 frames a second is cheap. Seen over the demo,
    full screen in both themes; the strip drawn by the painter on a fake clock. Not on real music.
  - **Comfort**: `prefers-reduced-motion` or Animations off (`useCalm`): slower attack and release, a cap that sinks
    gently, one flash a second. Always: `flash.ts` limits the mean brightness of the bars to 3 flashes a second (a flash
    = a rise and a fall of at least 10 % of the range; past the budget the brightness may not turn back by 10 % until
    older swings are a second old); the test runs a 10 Hz strobe through it and counts.
  - **Full screen** (`vizFull.ts`, `VizScreen.tsx`, lazy): V (rebindable, Settings › Shortcuts) or a double click on the
    strip; a click on the strip or the full screen: the next look (`vizClick.ts`, held 300 ms so a double click stays
    one); right-click: look, full screen; Esc or a double click leaves (`vizFullKeys.ts`, capture on the window, a
    menu on top keeps its Esc). The window goes full screen through `holdFullscreen` (`app/fullscreen.ts`: gives back only
    what it took, sees F11 / the title bar leaving it, sessionStorage flag for a reload), the same care as karaoke's.
    While it is up Now Playing's F and karaoke's K do nothing; the native watch page (a YouTube video that can't be
    embedded) is hidden, as for karaoke (`PlayerBar.tsx`). Not offered while Spotify plays. Click on the strip still
    does nothing (it did nothing before).
- **Radial, VU needles, spectrogram** (Visualizer v2 step 3, 2026-10-31). Same worker, same frames, three more looks
  in `vizPaint.ts`; their numbers are pure and tested (`vizVu.ts`, `vizSpectro.ts`, the geometry in `vizDraw.ts`).
  - **Radial**: bars on a ring, mirrored left and right, low notes at the bottom rising to meet at the top
    (`ringBars`). It is drawn behind a round cover, never the strip: in Now Playing (`Stage`, `NowPlaying.tsx`) the
    cover turns round and shrinks to 66 % of the stage's square, the canvas fills that square behind it, only when the
    stage is at least 330 CSS px, the art is square (within 6 %, so not a video frame with bars) and the song is not
    Spotify's; the strip under the cover then stays away (one worker, not two). Elsewhere the strip shows the bars
    look. The full screen puts the round cover in the middle of the ring. Moving cover (`pulse.ts`, a setting) scales
    the cover element and so works with the ring unchanged; the ring's own step on a kick: Beats, above.
  - **VU needles**: two dials side by side, L and R, each a damped spring in closed form (`stepNeedle`: exact at any
    frame rate), natural frequency 13.52 rad/s and damping 0.813: a step reaches 99 % in 300 ms with 1.24 % overshoot
    (the VU standard: 300 ms, 1 to 1.5 %; the test steps it at 1 ms and checks both). 0 VU is a sine 14 dB under full
    scale RMS (the streaming level); the scale runs -20 to +3 VU. The level is the frame's window RMS (header
    bytes 4-5; a full-scale sine reads -3 dB), not the bands summed: under 300 Hz the bands overlap, so a sum read 5 to 9 dB hot on bass. The peak LED lights at +3 VU and holds 1 s, so it changes at most once a
    second whatever the sound (under the flash limit, and under calm mode's 1). The dial (arc, marks, red end, numbers
    when tall enough) is drawn once to a bitmap per size and colour; the needles, hub and LEDs go over it each frame.
    `dialGeometry` fits the arc to any box: a shallow arc with the pivot below the box in the strip, up to 60 degrees of
    swing in a tall box. Colours: the theme's ink, and `--color-danger` for the red end and the lit LED. Reduced
    motion smooths the level (0.45 s) before the spring, so the needles drift.
  - **PPM needles** (2026-11-05): the same two dials as a digital peak programme meter (IEC 60268-18's ballistics). The
    needle jumps to the highest sample peak of the frames since the last drawing (header bytes 6-7), no spring, and
    falls back 20 dB in 1.7 s (`stepPpm`). The scale is dBFS, -40 to 0, with knees (`ppmPos`: -40 to -20 on the first
    quarter, -20 to -10 on the next, the top 10 dB on the right half, where today's masters peak; a straight dB scale
    crowded 6, 3 and 0 together), numbers 40 30 20 10 6 3 0, red from -3, "dBFS" under them when tall. The over LED
    lights at -0.5 dBFS and holds 1 s. A broadcast scale (BBC 1-7, EBU's) was left out: a mastered song pins it.
    Reduced motion smooths the reading as for VU. Switching between VU and PPM starts new needles.
  - **Meter face** (`visualizerFace`, under the style in Settings › Playback and in the strip's menu, both needle
    looks): the theme's colours, or Vintage, a cream face lit from behind (a warm glow low in the middle), a dark rim,
    black print and an old red, as on a 1970s hi-fi. It is part of the dial's bitmap: nothing more per frame. In a box
    much taller than its dial (full screen) the dial sits in the middle (`dialGeometry`), and its ticks, numbers,
    needle and LED take their sizes from the dial's radius, not the box (they were oversized there).
  - **Spectrogram**: time to the right, the log band axis up (low at the bottom), new column at the right edge. Each
    drawn frame copies the picture left by the whole device pixels due and paints the new column with `putImageData`
    (one pixel column, mixed between neighbouring bands, the theme's ink at an opacity that rises with the level, 256 steps, clear at
    silence, so it sits on any page and takes the theme; no hues of its own). Speed 90 CSS px/s (45 in reduced motion), counted by time, not by frames: the
    test scrolls 2 s at 24 to 240 Hz and 2x density and gets the same distance within a pixel. The picture is kept
    across messages but not across a resize or a look change. Canvas 2D is enough: no WebGL.
    **Spectrogram colors** (`visualizerColormap`, 2026-11-05; under the style in Settings › Playback and in the menu):
    Magma or Viridis instead of the ink, matplotlib's maps (CC0) from ten even samples each, mixed in between
    (`namedMap`), clear at silence and opaque from a quarter of the level up, so the strip still sits on the page. The
    same 256-step table the ink uses, so no WebGL for this either. A switch leaves the old columns to scroll away.
  - **3D terrain** (2026-11-05, `vizTerrain.ts`): the last 3.3 s of the spectrum as 40 rows of a landscape, the newest
    at the front following the sound, a new row every 1/12 s (1/6 in reduced motion) going back in perspective (depth
    1 to 3.5: higher, narrower, flatter) and fading out at the horizon. Back to front, each row clears what its hills
    hide (`destination-out`), then gets a faint body and its line in the theme's ink, so the page still shows through.
    64 points a row whatever the banding; every other row in a box under 160 px (the strip). At rest once every row
    is flat. Canvas 2D (40 rows of 64 points), not WebGL.
  - **A plugin's look** (2026-11-05, `features/plugins/pluginViz.ts`, `docs/plugins.md` › Visualizer shapes): a plugin
    with the `visualizer` permission registers one look, offered as "<name> (plugin)" in Settings and the menu (setting
    `visualizerPlugin`, not in the click round). While it shows and music plays, one feed per plugin sends it 31 bands
    (the overlay's third octaves), the beat, the tempo, level and peak, 30 a second at most; Rust keeps only the latest
    frame for a busy plugin. Its answer is a list of shapes (`drawList.ts` checks them), drawn by the worker in the
    theme's ink or its own colours until the next one. The plugin off or stopped: the bars instead.
  - **Presets** (2026-11-05; `vizExpr.ts`, `vizPreset.ts`, `vizPresetGl.ts`, `vizMilk.ts`, `vizPresets.ts`): MilkDrop's
    idea, written from scratch. Each frame the last picture is drawn again through a moving mesh (zoom, turn, warp,
    shift, stretch) and faded; the music's wave and two borders go on top, so the trails are the old pictures. A
    preset is starting values and equations in a small language of our own (`vizExpr.ts`: numbers, `+ - * / % ^`,
    comparisons, `if`, MilkDrop's usual functions, compiled to closures: the CSP has no `eval`; 4000 nodes a program)
    run once (`init`), every frame (`frame`: zoom, rot, warp, cx, cy, dx, dy, sx, sy, decay, the wave's and borders'
    colours…) and at every point of the mesh (`vertex`: the same motion bent by x, y, rad, ang). They read time, bass /
    mid / treb (each range's level over its own last seconds, about 1) and their smoothed `_att`, beat, bpm. The mesh
    is 32 × 24, fewer points when the point equations are long (40 000 nodes a frame); motion is scaled by the frame's
    length, so 30 fps moves as 60. Drawn by WebGL2 on the worker's own OffscreenCanvas (1024 px at most), copied onto
    the look's canvas: two pictures take turns, an 8-bit floor lets trails reach black, then gamma, echo (zoom, flip),
    invert / brighten / darken / solarize. Wave modes 0 to 7 (circle, scopes, spiral, lines; dots, thick, additive). The
    picture's mean light (its smallest mipmap, one pixel read back) goes through the flash limiter: dimmed past its
    budget. Reduced motion: half speed, no beats, the calm budget. At rest 4 s after the last frame, the picture kept.
    No WebGL2 (asked once, `canDrawPresets`): the bars.
    **Preset colors** (`visualizerPresetColors`): the theme's ink, the picture's light as its opacity, so it sits on
    any page, light or dark (default); or the preset's own, black see-through.
    **Which preset** (`visualizerPreset`, Settings › Playback and the menu, with Next preset): 9 built in, Tunnel first
    (their ids live in settings: never rename one), and up to 32 imported ones, 16 kB of equations each, kept in the
    settings like own themes, so Sync Mode carries them. Import: MilkDrop's `.milk` (`vizMilk.ts`: base values,
    `per_frame_init_N`, `per_frame_N`, `per_pixel_N`; custom waves and shapes, shaders and motion vectors are not
    drawn, and the app says so when equations can't be read) or our `.json` (`kind: 'legato-preset'`). Export: the
    preset shown, as `.json`. Files go through `read_preset` / `write_preset` (`themes.rs`, 256 kB at most).
  - **Drawn at 30 fps** (`FPS` in `VizCanvas.tsx`, sent with the look; the worker's loop skips a tick that comes less than a
    period minus 3 ms after the last drawing): at the screen's 60 the bench showed 5 of 16 looks and sizes over the
    3 % budget (up to +4.6 points of the PC), at 30 all four looks run again were +1 to +1.9. The sound's own frames stay at
    60 Hz (the newest one is used, and the needles and bars are time-based). Numbers: `docs/performance.md`.
  - **Silent frames are silence**: the twins send one all -120 frame when the sound stops or a window is all zeros
    (a gap, a stalled buffer); `frameMessage` (`vizProtocol.ts`) turns it into the worker's `silence`, so the bars fall and
    the loop stops at rest instead of redrawing a blank canvas. The native levels poll (`live.ts`) runs only for
    processing, the moving cover or the loudness meter (`LiveWish.levels`), not for the other looks. In the visualizer's full screen, search,
    settings and back / forward do nothing, the focus is dropped on open, and Esc leaves even from a field behind it.
  - **Everywhere**: all three obey reduced motion (`useCalm`) and the flash limiter (the spectrogram and the ring read
    the limited heights; the needles are not brightness). Every look is offered in the strip, Settings and the
    full screen; Radial says where it falls back (the Settings row). The e2e walk draws each, in Now Playing and full
    screen, and reads a screenshot of both (`target/e2e/shots/10-radial.png` and on).
  - **The data path in short**: the engine's tap (after gain and limiter, before the volume knob) is copied only while a
    `viz_start` channel exists; a worker thread runs the FFT and sends 130-byte frames at 60 Hz; the page unpacks them
    (`vizFrames.ts`) and hands the arrays to the render worker; YouTube's frames come as base64 text from `live.js`.
    `viz_stats` returns the workers alive and the frames sent so far (a count, nothing of the sound): the e2e walk
    checks that frames come while a look is open and that none are sent, and no worker lives, after it closes.

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
- (b) Reading playlists and Liked Songs through the session's token: **never**. The web player's access token comes from
  `/api/token` with a TOTP whose secret is hidden in the player's code; getting it means rebuilding that scheme (defeating a
  technical protection) or capturing the token the official player fetches.
- **Connect Spotify** (Add music, `ui/src/features/add/SpotifyConnect.tsx`, user's ask 2026-10-31: any free account, private
  playlists and Liked Songs, instant, no risk to the account). First way, **Exportify** (`src-tauri/src/spotify_export.rs`,
  `crates/core/src/spotify_export.rs`): its page (exportify.app, open source, not ours) in an app window with no IPC.
  `crates/shield/src/exportify.js` presses its two buttons (`#loginButton`, `th.export button`: same in every language), so
  its own code reads the official Web API and makes its ZIP of CSVs, one per list, `liked.csv` for Liked Songs. Consent on
  Spotify's page stays the user's, the first time: the script runs on exportify.app only, and leaves the page alone when
  Spotify sends it back with a refusal. Tauri's `on_download` puts the file in the cache, it is read and deleted, and every
  list comes straight in: no file to see, nothing to tick. Header in the browser's language, same columns in each, so read
  by position. The same list imported again replaces its copy (id: the file's name). Progress is a screen, `features/add/ImportScreen.tsx` (pure part `importRun.ts`): covers land on a
  fanned deck, updates every 120 ms at most, Hide leaves a toast. Every list is saved first, in seconds, with the YouTube
  versions the library knows (`Library::known_youtube`); then each unknown song is searched once, across all the lists, its
  version joining them as it comes (`Library::add_version`). A search brings back around twenty songs, so what it found settles
  the songs in line with no search of their own (`searchpace::Line`, the artists with the most songs first). The screen says
  the time left from the last 90 s up to now, so what YouTube holds back counts, and the wait under way on a line of its own.
  Google sets the speed: too many searches from one address get its "Sorry…" page (403, slow, seen at 5 to 9 s), which is
  not a missing song. A refusal costs more than the import: Google then limits the whole address for hours, the YouTube
  player's starts too (2026-11-01: 1840 searches up to 8 at once, then a third of the songs refused at their start all
  evening). So `music_core::searchpace::Pace` runs one search at a time, 3 s apart (20 a minute at most); a refusal waits
  5 min (10 min the next time), the song goes back in line, the gap doubles for the rest of the run (up to 15 s), and 15
  min of nothing but refusals ends the search, two searches into a block at most: an import later finishes it. Never
  around a refusal: no other endpoint, no CAPTCHA, no faster retry. A song truly not found (a real
  answer, no match) goes in `not_found` (schema v14, a cache, not synced): an import leaves it alone for 30 days, and Songs
  not found (`features/library/NotFoundView.tsx`, in the sidebar when there are some, and on the import's last screen) lists
  them, to find by hand or search again with the import's screen and pace. Liked Songs joins Liked Music,
  whatever the way in (`Library::add_likes`, user's choice 2026-10-31): no second list of likes. YouTube Music's Liked Music is
  rewritten by every sync, so a song not in it waits in your own, and at the next sync the ones with a YouTube version
  are liked on the account (`push_own_likes`, one every 400 ms). Exportify is a third party's site, so its window is watched (`Watch`, pure, in `music_core::spotify_export`;
  the page says `ready` and `busy` on WebView2's message channel): 30 s without its buttons = down, 5 min of silence
  while reading = stalled, the sign-in button still there after Spotify = refused. Any other site in that window is a
  sign-in, the user's, no limit, except Spotify's own pages past a sign-in (its player, its account page, `/status`): nothing
  there leads back, so the window returns to Exportify, twice at most. Its sign-in and consent pages are never touched. Each ends in a dialog offering Try again and the second way, never a window left waiting.
  Sync directions decide each hop: Spotify's (Settings › Accounts,
  shown without a key too) has to bring things in, or Connect Spotify says so and stops; YouTube Music's has to send, or
  the songs stay in your own list. Nothing goes to Spotify: Exportify only reads, and writing needs the official API, so a
  key and Premium (`DirectionPicker` keeps Import only and Off).
  **Why not our own copy of it:** the code is the easy part, Legato already has PKCE. What it has is a key that serves
  everybody. A new app is in Development Mode (Premium owner, 5 allowlisted users), and extended quota is only for
  organizations with 250k monthly users. Its key stays in its page: Spotify only redirects to the addresses registered for
  it, and passing as another app isn't ours to do. So a fork of its source, ours to host, gets nowhere: the app drives
  its page instead. If exportify.app goes or changes its buttons, the second way stays.
- Second way, **Spotify's page read** (user's choice 2026-10-31), behind "Read Spotify's page instead". No token and no
  request of ours: the window opens on Spotify's sign-in page,
  `crates/shield/src/spotify.js` (injected in that window only) reads the rows the page draws and posts them on WebView2's message channel; `crates/connectors/src/spotify_page.rs` checks sender, shape and
  sizes. The window stays on top while reading (Chromium stops drawing a hidden window). Each song then goes through
  `with_youtube`, like a link import, and the list is saved under the same id, so a second import refreshes it. Cancel
  keeps the lists already saved. A row exists only once loaded, so the reader never scrolls past the last one (a long list loads in parts, and a
  stretch it skips never draws). A list that fails, reads empty or comes out short of the count its page gives is named
  at the end, never saved over the old copy. The library column has no links: a row's kind is in its ids
  (`listrow-title-spotify:playlist:<id>`, any language), and its subtitle gives the owner, not a song count.
  Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) ban scraping, by hand or automated, and a
  breach can close the account (no such case found): the app says so before the first connection on each PC.
- **Public playlists and albums by link**, no account
  (`crates/connectors/src/spotify_embed.rs`): the official embed page (`open.spotify.com/embed/<kind>/<id>`) carries the
  list in its `__NEXT_DATA__` JSON (first 100 tracks). Each track is matched to YouTube Music's songs, then to a music
  video on normal YouTube (`with_youtube`, 6 at a time), and plays through the YouTube embed. Signed out, YouTube
  Music's public catalog answers (2026-10-30: before, a signed-out import came in with nothing playable). Saved as an
  imported Spotify playlist; importing again refreshes it. Paste the link anywhere (Ctrl+V) or in Add music.
- **Deezer and Apple Music links** (2026-10-31), same flow, metadata only (no audio, no preview URL kept). The connectors
  give a name, a cover and the songs (`crates/connectors/src/deezer.rs`, `itunes.rs` `link_list`, shared `LinkList`);
  `src-tauri/src/links.rs` (`import_link`) matches each song to YouTube with `with_youtube`, like the Spotify import, and
  puts the ones found in a **new playlist of yours** (not a synced one: a new library source would break the other PCs
  of Sync Mode that do not know it). The toast says "12 of 13 songs found". While it matches (up to 3000 searches, 6 at a time)
  the command emits `import-progress` `[searched, total]` after each batch: a toast that stays reads "Importing from Deezer…
  120 of 300", with a Cancel that calls `import_link_stop` (nothing is made, "Import canceled"). One import runs at a time.
  - Deezer: `api.deezer.com/playlist|album/{id}` for the name, then `/tracks?index=&limit=100`, page by page, ISRC
    included. Quota (50 requests / 5 s) comes as HTTP 200 with an `error` object (code 4): wait and try again, 4 times.
    Private or removed lists answer code 800 or 200. `link.deezer.com/s/…` short links: one redirect, read in Rust and
    followed only to a deezer.com page. Hosts accepted: `deezer.com`, `www.deezer.com` (with /fr/ and the like),
    `link.deezer.com`, nothing else.
  - Apple Music, albums: the iTunes lookup (`entity=song&country=<store of the link>&limit=200`); the store in the link
    matters, region-only albums come back empty otherwise. Playlists have no keyless API: the public page's
    `serialized-server-data` JSON (editorial `pl.<hex>` and users' `pl.u-…` alike; around 100 songs at most on the page,
    the toast says when the list is longer). The page URL is built from the store and the id, never from the pasted
    text. If the layout changes the error says so in plain words and points to Import a list of songs. Single-song links
    (`/song/`, `?i=`) are refused in plain words.
  - Base URLs live in `src-tauri/src/hosts.rs` (the e2e build sends them to a dead port or the mock). Covers: exact hosts
    `cdn-images.dzcdn.net`, `e-cdns-images.dzcdn.net` and `*.mzstatic.com` in the `art` allowlist.
  - Fixtures in `e2e/fixtures/` (`deezer-*.json`, `apple-playlist-*.html`, `itunes-lookup-album.json`) were recorded by
    hand on 2026-10-31 and cut down to the fields the parsers read.

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
