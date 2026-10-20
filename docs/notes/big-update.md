# Big update (2026-10-20): technical plan

Branch `big-update`. Task list with checkboxes: [plan-v2.md › Big update](plan-v2.md#big-update-2026-10-20-branch-big-update).
This file holds the how: order, approach per task, rules changed, what is possible or not, and risks. Updated as
work lands ("Decisions taken on the way" at the end).

## Order

Phases in the user's order. Inside a phase, the small and independent tasks first, so each commit stays small.

1. **Phase 1 (fixes)**: progress bar, YouTube overlay, sidebar scroll, cover / video auto-crop, YouTube import order,
   YouTube search (normal YouTube + music filter), blocked videos (101 / 150) through the watch page.
2. **Phase 2 (changes)**: Up next history, top bar (remove sync and back / forward, "Music App" goes Home everywhere,
   bar over the player's background), click on cover / video, right-click removals, Add music plays without adding,
   import music filter, keyboard shortcuts (editable, global), tray / background mode, auto-update at launch,
   optimization last (measured before / after on the result of the other changes).
3. **Phase 3 (features)**: live audio processing core (needed by three features), then thumbnail toolbar, navbar
   search bar, translation (en + fr), lyrics mode, Music Detector, voice search, cover animation, Adaptive Sound.
4. **Phase 4**: Live Editor, Sync Mode, plugins, theme creator, one at a time.
5. **Phase 5**: health check report + fixes.
6. **Phase 6**: one review agent (the only agent of the whole job, asked by the user by name).

Every step: `pnpm check` green, app started (`pnpm dev`) and the change driven when it is visible, small commit.
The dev build uses the user's real data: `library.db` was copied before any migration (scratchpad backup).

## Phase 1

### Progress bar stuck (root cause found)
`Progress.tsx` `SeekBar` keeps a local `drag` value, shown instead of playback (`value={drag ?? pos}`). `onChange` sets
it; only a `pointerup` on the wrapper clears it. After a click, Chromium leaves focus on the `<input type=range>`; any
arrow key (and Shift / Ctrl + arrow: the app skips modifier shortcuts inside an `input`) changes the range natively →
`onChange` → `drag` set with no pointer event to clear it. The bar stays pinned forever (the next song too), and any
press-release on it (e.g. dragging back to 0) clears it: the user's exact symptom. Second path: release outside the
input after the track changed under the pointer (bar disabled while the duration is unknown).
Fix: drag state lives in a small pure state machine (`seekDrag.ts`): only a pointer down starts a drag; keyboard
changes seek without pinning; pointer up / cancel / lost capture / window blur / track change all end it; seek is sent
on release (one seek instead of dozens during a drag). Range inputs no longer swallow the app's modifier shortcuts.
Test: keyboard change then track change → bar follows playback; pointer down, track change, no pointer up → not pinned.

### YouTube overlay
`bare.js` hides overlays with one adopted stylesheet. Two weak points: YouTube can replace `document.adoptedStyleSheets`
(drops ours), and the list misses overlays (cued thumbnail with title, "Tap to unmute", up-next / autonav, video wall,
error screen, bezel, spinner, ad overlays). Fix: a `<style>` element kept in the document (re-added by a
`MutationObserver` if removed) plus the adopted sheet, a complete selector list, and a test that checks the list.

### Sidebar scroll in a small window
The whole `<aside>` scrolls (`overflow-y-auto`); at the 600 px minimum height its content is ~540 px for a 500 px
row, so a scrollbar always shows, and Now Playing (from y = 52) leaves only its top visible. Fix: fixed header, only
the nav / playlists part scrolls (thin scrollbar on hover), fixed footer. Phase 2 moves the logo and the search into a
full-width top bar, which removes the header from the sidebar altogether.

### Cover / video auto-crop
Detection exists (`artbox.ts`) but fails on the user's case: the image is sampled at 160 px with low-quality smoothing,
so the thin light line between bar and picture is caught on one side and missed on the other; the scan then runs into
the picture's dark edge, sides differ by more than 4 %, and the axis falls back to "no bars". Failures are also cached
for the session. Fix: sample at 320 px with high-quality smoothing; recognize the thin bright seam next to a bar as
part of the bar; try the standard pillarbox / letterbox geometries first (4:3, 1:1, 9:16 in 16:9, 16:9 in 4:3) and
accept them when their bands are near-pure black whatever the picture holds; uneven sides → symmetric minimum
(YouTube bars are centered); no cached failures. Same box applied to the immersive backdrop and the tint (bars
excluded), the "still" detection (difference measured inside the picture only) and **the video**: the iframe is
enlarged and clipped to the detected box (`clip-path`, no DOM move, so no reload), box taken from the video's frames.
Fixture test made from the reported case.

### YouTube import order
Rust ranks "date added" from the service order and assumes only Liked Music is newest first (`newest_first()`, by
name). The user checked: their imported YouTube playlists come newest first too, so both sorts are inverted. Fix: a
per-playlist `newest_first` column. YouTube playlists default to newest first; each sync compares with the previous
mirror (new songs at the top or the bottom?) and corrects the flag; a playlist menu entry overrides it by hand.
Migration v5 re-ranks the existing rows (same method as v4). Tests in `library.rs` and `filter.test.ts`.

### Search on normal YouTube
- Method: YouTube's own web API (InnerTube `youtubei/v1/search`, client `WEB`), called from Rust like the existing
  YouTube Music client, with the signed-in Google session when there is one (anonymous otherwise: visitor id). No
  key, no quota. **Rule changed**: "YouTube Music's own web API" becomes "YouTube and YouTube Music's own web APIs".
- Risks: unofficial (can break; parsers tested on sample answers and reshuffled ones, like `ytmusic.rs`), YouTube may
  rate-limit or ask for bot checks (searches are cached 30 min, one request per search), ToS like the existing client.
- Results: YouTube Music songs and normal YouTube videos merged (same song = one row). A pure Rust classifier
  (`music-core`, tested) scores each video: positive signals (`- Topic` / VEVO channels, official artist badge,
  "Artist - Title", official video / audio / lyrics / remix / feat., length 1–12 min, YouTube Music hit), negative ones
  (reaction, review, tutorial, podcast, gameplay, trailer, interview, news, unboxing, Shorts, very long non-mix). Only
  clear non-music is hidden; doubt keeps it. The UI shows "13 videos hidden because they aren't music" (real count)
  with a Show button.

### Blocked videos (errors 101 / 150)
- Detection: already there (`onError` through the `postMessage` protocol).
- Fallback, only for those errors: YouTube's own watch page (`youtube.com/watch?v=…`) cannot be framed
  (`X-Frame-Options`), so it opens in a **child webview** of the main window (Tauri multi-webview, `unstable` feature)
  placed exactly over the video slot. An init script hides everything around `#movie_player`, the overlay rules of
  `bare.js` apply, and the shield's request filter is installed on it too.
- Control: the app's commands go through Rust (`eval` on that webview: play, pause, seek, volume, load); the page
  reports state, time and errors through one dedicated, capability-scoped command (that webview only, youtube.com
  only, one validated command, nothing else from IPC).
- Same store path as the embed, so pause, seek, volume, next, fades and the session work unchanged; at the end of the
  song the next one plays (YouTube's autoplay is stopped).
- Still unplayable (region, age without a signed-in adult account, removed, private): the watch page reports the
  playability status → a clear message, then the next song. Before all this, the other-upload search stays the first
  try (it keeps the embed).
- Limits: the native child webview sits above the HTML, so a menu opened over the video goes under it (menus are
  moved aside while it shows); the watch page adds the video to the signed-in account's YouTube history (it's the
  user's own account).

## Phase 2

- **Up next**: the store never drops played songs, the view sliced them off. Played songs shown above the current one
  (dimmed, clickable), list scrolled to the current one, whole queue virtualized.
- **Top bar**: one full-width bar like YouTube's (logo "Music App" left, search center, window buttons right). Sync
  icon and back / forward removed (Alt+← / Alt+→ and the mouse's back / forward buttons keep working; sync stays in
  Settings › Accounts and the app menu). Any navigation closes Now Playing (one subscription, no circular import), so
  the logo goes Home from the player too. Over Now Playing the bar is transparent: the player's backdrop or tint runs
  under it, and the native window background follows.
- **Click on cover / video**: our own handler on the video slot and the cover (the iframe stays
  `pointer-events: none`), a click-versus-drag threshold for the mini player.
- **Right-click removals**: "Remove from ›" lists every playlist holding the song: custom ones locally (all
  occurrences, Undo), YouTube Music ones on the account (`ACTION_REMOVE_VIDEO` with the item's set id, Liked = remove
  like; playlists the user doesn't own shown disabled), Spotify ones disabled (read-only). "Remove from library":
  removes it from custom playlists, offers the imported ones, and leaves a tombstone so a sync or a folder rescan
  doesn't bring it back (files on disk are never touched).
- **Music filter on import**: same classifier, with YouTube Music's video type (song / official video / user video /
  podcast). Nothing is deleted: non-music items are flagged and hidden by default ("N videos hidden… Show").
- **Add music plays without adding**: play button and double-click on results (session-only queue items, like Home's
  recommendations); full songs through their YouTube version.
- **Keyboard shortcuts**: data-driven bindings (one table, `app/shortcuts.ts`), editable in Settings › Shortcuts (press
  keys to bind, conflicts shown), matched on physical keys (`e.code`, any keyboard layout), more actions (stop, mute,
  like, Now Playing, lyrics, Live Editor, search). Optional **global** bindings (work in the background and in the
  tray) through `tauri-plugin-global-shortcut`, with safe defaults (Ctrl+Alt+…); a binding another app already holds
  is reported. Media keys are never registered (the Windows media session already handles them; Chromium's own media
  key handling is turned off so the YouTube frame can't react twice).
- **Background / tray**: closing hides the window (`CloseRequested` → hide), "Quit" (tray) is the only exit, second
  launch shows the window (single instance). Hidden: WebView2 controller hidden (page `hidden`, no painting, timers
  throttled), memory target `low`, UI polling and animations stopped; music keeps playing. Nothing playing for a while
  while hidden → webview suspended, resumed on any tray / media / shortcut action. Back in a few hundred ms.
- **Auto-update**: checked at every launch (after a few seconds, not 20) and when the window comes back from the tray
  after a long time; downloaded in the background only when Automatic updates is on. Installed at a quiet moment
  (paused) or **between two songs** (natural end), then the app comes back and plays on from the next song. Gap of a
  few seconds between songs; never mid-song.
- **Optimization** (measured with the release build through the WebView2 DevTools protocol and process memory):
  selectors instead of whole-store subscriptions (Now Playing, PlayerBar, Transport, MiniPlayer, App, Sidebar), shared
  memoized lookups, virtualized Albums / Artists / Up next, lazy screens, nothing running while hidden, startup work
  deferred, release profile (LTO, one codegen unit).

## Phase 3

### Live audio processing (Live Editor, Adaptive Sound, cover animation)
Two engines, one model: a **mix** is plain parameters (JSON), never audio.

- **Local files and Apple previews**: a new pure-Rust DSP crate `music-dsp` (no Tauri, no network) used by
  `music-player` as a processing stage around each rodio source. Parameters change live without locks on the audio
  thread, smoothed (no clicks), levels metered and sent to the UI.
- **YouTube: studied, and what was chosen.**
  - *Per-process loopback capture* (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` on the WebView2 process tree).
    Documented minimum: Windows 10 build 20348, so Windows 11 in practice; the app supports Windows 10. Muting the
    webview (`ICoreWebView2_8::IsMuted`) mutes Chromium's stream itself, so the capture would get silence; muting the
    process's audio session is not documented to leave the capture alive. Added latency: capture period + processing
    + output buffer ≈ 40–100 ms of sound behind the picture, noticeable on music videos. "Slowed" can't be done on a
    live capture (it would drift away from real time): it needs YouTube's own playback rate anyway.
  - *Inside the YouTube frame* (chosen): the app already injects scripts into YouTube's frames. A new script takes the
    video's sound with `captureStream()` (a stream of the element; the element is then muted, so only the processed
    sound is heard), runs it through Chromium's own native audio nodes (biquad EQ, convolution reverb with a generated
    impulse response, compressor, HRTF panner for 3D / 8D, delay, stereo width, gain, analyser), and plays it.
    Speed with pitch ("slowed", "nightcore") = the video's own playback rate with pitch preservation off: picture and
    sound stay in sync. Pitch alone: a delay-line pitch shifter made of native nodes.
  - Why: no Windows version limit, no muting trick, a few ms of extra latency instead of tens, sync kept for slowed,
    little CPU (C++ nodes). Turning it off or any failure = unmute the element and drop the graph: normal playback,
    no error (that's why `captureStream` and not `createMediaElementSource`, which can't be undone).
  - Limits: the two engines are not bit-identical (e.g. Chromium's HRTF data vs our binaural model): same controls,
    close sound. Works in the watch-page fallback too.
- **Spotify**: plays in Spotify's own app (Spotify Connect), outside the app: no processing (it would mean capturing
  another app's protected stream). **Apple Music**: only the 30 s previews play, through the native engine: processed
  like local files. Full Apple Music needs MusicKit + DRM: no.
- Switch: Settings › Advanced › "Live audio processing" (on by default only where needed: a mix, Adaptive Sound or
  the cover animation turned on).

### Thumbnail toolbar (taskbar)
`ITaskbarList3::ThumbBarAddButtons` after the `TaskbarButtonCreated` message, clicks through a subclass of the window
(`WM_COMMAND` / `THBN_CLICKED`), icons drawn in Rust at the window's DPI, Play / Pause updated from the player state
(`ThumbBarUpdateButtons`), icon color following Windows' light / dark taskbar, tooltips translated. Works on Windows 10
and 11.

### Navbar search bar
In the new top bar, always visible: field + search button + mic button (like YouTube). Enter or the button opens a
Search page: library matches, then YouTube Music + YouTube results (with the music filter). Ctrl+K focuses it.
The mic opens a small menu with two big choices: "Search by voice" and "Identify a song" (Music Detector).

### Voice search
- The Web Speech API is not usable in WebView2 (Chromium turns it off in webviews; no Google speech backend).
- Chosen: Windows' own speech recognition (`Windows.Media.SpeechRecognition`, WinRT) from Rust, in the UI language.
  It needs Windows' "Online speech recognition" setting (speech goes to Microsoft's service, documented in the
  README's privacy section); when it's off, the app says so and opens that settings page. No server of ours, nothing
  recorded.

### Music Detector
- Section under "Add music" (and from the mic menu): listens ~10 s (microphone captured in Rust, kept in memory only,
  never written), identifies, then "Play", "Add to library", "Add to playlist ›".
- Service: **AudD** with the user's own API token (keychain). One token, simple multipart upload, returns Apple Music
  and Spotify ids (we then find the YouTube version); 300 free requests to try, then cheap paid plans. Shazam has no
  public API (the unofficial ones reverse-engineer its signature: refused); AcoustID needs whole clean recordings (not
  a noisy microphone); ACRCloud needs three secrets and request signing (kept as a possible second provider).
- Clear permission step before the first use; Windows' microphone privacy switch checked and explained.

### Translation
- Lightweight, no dependency: `ui/src/shared/i18n/` with `en.ts` (source of truth: keys → English) and `fr.ts`
  (typed so a missing key fails the type check), `t(key, params)` with plurals, `Intl` formats by locale.
- Language: setting `language` = `system` (Windows display language through Rust, English if unsupported) or a fixed
  one, picker in Settings. Adding a language = one file + one line.
- Settings search: rows get stable ids (`data-setting="appearance.font"`), the index holds translated labels and
  keywords, search matches the current language and English. Rust strings shown to users (tray, errors) follow the
  language too. **Rule changed**: "English by default" → "English by default and as fallback; the interface follows
  Windows' language or the user's choice". Code, comments, docs and commits stay English.

### Lyrics mode
- Source: **LRCLIB** (free, no key, open database, time-synced LRC + plain), through Rust, matched by title, artist,
  album and duration, cached in SQLite (offline later, spares the service). Fallback: YouTube Music's own lyrics
  (plain text) when signed in. A purely client-side system can't exist: lyrics are data we don't have.
- Now Playing › Lyrics: cover left, lines right, current line highlighted and centered, smooth scroll, click a line
  to seek; plain lyrics scroll statically. Privacy section lists LRCLIB.

### Cover animation and Adaptive Sound
- Both read the levels of the live audio processing (native engine or YouTube frame).
- Cover animation (Advanced, off by default): the cover scales with the smoothed loudness (small range, eased,
  `transform` only, off with "reduce motion").
- Adaptive Sound (Advanced, off by default): short-term loudness (K-weighted) compared with the target picked by the
  user's volume; gain moves slowly (no pumping) within limits, a limiter guards peaks. Under the volume bar a second
  bar shows the adapted volume and the measured level.

## Phase 4

### 4.1 Live Editor
- Panel opened from the player (button, shortcut, menu). Sections: **Speed & pitch** (speed with pitch, tempo only,
  pitch only in semitones; presets slowed / nightcore), **Tone** (bass boost, 5-band EQ, presence / air), **Space**
  (reverb: size, decay, damping, pre-delay, mix; echo), **3D / 8D** (position of the sound around the head on a
  circle, distance, height, automatic rotation and its speed, room), **Dynamics** (compressor, limiter, loudness),
  **Stereo** (width, balance, mono).
- Native engine (`music-dsp`): RBJ biquads, reverb by convolution with a generated impulse response (the same
  generator drives Chromium's ConvolverNode, so both engines sound alike) through partitioned FFT, WSOLA time-stretch
  for tempo / pitch alone, resampling for speed with pitch, binaural panning from scratch (interaural delay, level
  difference, head shadow filter, early reflections), compressor / limiter, parameter smoothing, reset of effect tails
  on seek. Ideas from Audacity's effects (no code: Audacity is GPL).
- Mixes in SQLite (`crates/core`, migration): several mixes per song, one active, plus presets usable on any song.
  Only parameters are stored.
- Export (local files only): the mix applied offline to a **new** WAV or FLAC file next to a name the user picks; the
  original is never touched; progress and cancel. Not offered for YouTube, Spotify or Apple Music.

### 4.2 Sync Mode
- **OneDrive**: detected (environment variables and the OneDrive registry key); the app proposes a "Music App Sync"
  folder there and asks whether the files should be **encrypted** (password → Argon2id key → XChaCha20-Poly1305; the
  password stays in each PC's keychain) or plain. Any other folder works too (another cloud, a USB drive).
- **Second way: local network**, reusing nearby sharing (mDNS + SPAKE2 with a 6-digit code): two PCs pair once, keep a
  shared key in their keychains, and sync directly whenever both are on the same network. No cloud, no server.
- What syncs: settings, themes, custom playlists, imported playlists and accounts list (which services, which Google
  accounts), local folders (as suggestions: paths differ per PC), saved mixes, plugin list and settings, listening
  history and "less like this" marks, hidden playlists, covers.
- Secrets never leave the keychain: a PC that receives an account list shows "Sign in again on this PC".
- Model: each PC writes only its own file (no cloud conflict copies); records carry hybrid logical clocks; merge =
  last writer wins per record, deletions as tombstones, playlists merged so a song added on each side is kept.
  Tested on pure Rust merges.

### 4.3 Plugins
- **Rule changed**: "Built in only: no third-party code is loaded" → "Built-in add-ons, plus local third-party plugins
  run sandboxed, with permissions the user approves; no plugin touches the network or secrets directly".
- Package: a folder (or `.zip`) with `manifest.json` (id, name, version, author, `apiVersion`, entry, permissions,
  contributions) installed into the app data folder. The install dialog lists every permission; nothing runs before
  approval; disable, update (new permissions = new approval) and uninstall.
- Isolation: each plugin runs in a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin) served by a dedicated
  URI scheme with a strict CSP (`connect-src 'none'`: no network, no IPC), so a plugin only has `postMessage` to a
  broker in the host. The broker checks every call against the approved permissions; network goes through a Rust
  gateway with the manifest's host list; storage is per plugin (SQLite); secrets are never reachable. Unresponsive
  plugins are stopped.
- API v1 (semver, `apiVersion` checked at load): player state and events, playback and queue control, library and
  playlists (read / write by permission), context-menu entries, commands with shortcuts, settings page (declarative
  fields), panels (sidebar view, Now Playing tab), themes, notifications, storage, network. Docs:
  `docs/plugins.md`; example plugin in `examples/plugins/`.

### 4.4 Theme creator
- "Themes" and "Appearance" become one **Appearance** section: gallery, then an editor with tabs (Colors,
  Typography, Shapes, Background, Layout and behavior).
- Everything goes through the theme (except the app name, its logo and legal notices): every color token (status
  colors and scrollbars included), UI and mono fonts (presets or any installed font), radii, density and sizes,
  shadows and glow, icon weight, background image (picked file copied to the app data folder, served by the `art`
  scheme, CSP unchanged), its blur / dim / position, player and sidebar layout options, motion.
- `.theme` files (versioned JSON, background embedded) to export / import; the editor previews live and keeps the AA
  contrast check. Settings search updated.

## Rules changed (summary; each lands with its code, docs updated in the same commit)

| Old rule | New rule | Why |
|---|---|---|
| YouTube: YouTube Music's own web API only | YouTube and YouTube Music's own web APIs (still no key) | Search on normal YouTube, watch-page fallback |
| Legal playback only, official players, nothing extracted | + live processing of the app's own output (parameters only, never recorded or exported for streaming services) | Live Editor, Adaptive Sound, cover animation |
| Built in only: no third-party code | + sandboxed local plugins with approved permissions | Plugin system |
| No network except our connectors | + LRCLIB (lyrics), AudD (user's key), Windows speech service (if the user enables it) — all through Rust, listed in the README's privacy section | Lyrics, Music Detector, voice search |
| English by default | English default and fallback; UI follows Windows' language or the user's pick | Translation |
| No server of ours | unchanged; + writes to a user-picked folder (OneDrive…) and syncs on the local network | Sync Mode |
| (none) | Microphone only on explicit request, permission explained, audio kept in memory | Music Detector, voice search |

## Not possible, or not done as asked

- Live processing for Spotify (plays in Spotify's own app) and full Apple Music (DRM): not possible; previews yes.
- Export of a modified version for YouTube, Spotify, Apple Music: forbidden by the fixed limits; local files only.
- Web Speech API in WebView2: not available; Windows speech recognition instead (needs its online setting).
- Process loopback capture as the YouTube path: rejected for the reasons above (study kept here).
- An update never interrupts a song, but the restart leaves a few seconds of silence between two songs.

## Decisions taken on the way

(Filled in as the work goes.)
