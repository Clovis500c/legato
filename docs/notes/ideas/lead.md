# 2. Beat Riff

Things Riff can't or won't do. Our lead today: legal playback (no yt-dlp downloads), Tauri (light), Sync Mode,
Last.fm, Music Detector, the Live Editor, the Windows media panel.

## "Why Legato" on the website

- **Sees**: a section on https://clovis500c.github.io/legato/ (and a short line in the README): four cards, Legal (plays
  through the official players, nothing downloaded), Light (measured RAM and start time), Your PCs in sync (no
  account, no server), Your scrobbles (Last.fm). No competitor named.
- **How**: `site/components/content.tsx` (copy), a new component beside the features grid, in every site language.
  Numbers from `docs/performance.md` ([optimisation.md](optimisation.md) › Measure).
- **Rules**: claims must stay true; numbers dated ("measured 2026-11, Windows 11, 10 000 songs").
- **Needs**: the bench numbers.
- **Effort**: S. **Risk**: none.
- **Done when**: live on Pages, both languages, numbers sourced.

## Personal servers: Jellyfin, Navidrome / Subsonic, Plex

- **Sees**: Settings › Accounts › "Your music server": address, user, password (or Plex sign-in); the server's
  library appears like a source (songs, albums, artists, playlists), plays natively with the Live Editor, fades,
  gapless; likes and plays sync back (Subsonic `star` / `scrobble`, Jellyfin favourites / playback reports).
- **How**: `crates/connectors/src/subsonic.rs` (Subsonic API: token = md5(password + salt), `getAlbumList2`,
  `getPlaylists`, `stream.view`), `jellyfin.rs` (API key per device after `AuthenticateByName`), `plex.rs` (PIN
  sign-in, X-Plex-Token). Streams go to `crates/player` as HTTP sources (symphonia over a buffered reader with range
  requests) so the native chain applies. Library sync in `music_core::sync` like other services. Covers through the
  `art` scheme with the server's host added to the allowlist at sign-in.
- **Rules**: the user's own music on the user's own server: allowed ("personal servers" in CLAUDE.md). Passwords and
  tokens in the keychain; Sync Mode carries them only sealed. Plain HTTP on the LAN allowed; warn on HTTP over the
  internet. Privacy row: "your own server's address, only".
- **Needs**: HTTP streaming in `crates/player` (seek by range, buffering, network errors → `shared/errors.ts`).
- **Effort**: L (three APIs; Subsonic first covers Navidrome, Airsonic, Gonic, Ampache). **Risk**: transcoding
  formats (ask for raw or mp3/opus as the server allows), self-signed certificates (a per-server "trust this
  certificate" with its fingerprint).
- **Done when**: Navidrome in Docker on the dev PC (documented in `docs/development.md`): sign in, sync 1 000 songs,
  play, seek, gapless, scrobble back; mockito tests per API.

## Cast: DLNA / UPnP and Chromecast

- **Sees**: a Cast button on the player bar: speakers and TVs on the network; picking one moves playback there, the app
  becomes the remote (volume, seek, queue).
- **How**: discovery: SSDP (UPnP MediaRenderer) and mDNS `_googlecast._tcp`. DLNA: AVTransport `SetAVTransportURI`
  with a URL served by Legato (a small HTTP server on the LAN, one random path per song, only while casting).
  Chromecast: CASTV2 over TLS with the Default Media Receiver (protobuf messages, a crate or our own small client).
  New crate `crates/cast`, shell `src-tauri/src/cast.rs`.
- **Rules**: only sources whose audio we may serve: local files and personal servers (the device can fetch the
  server's URL directly). YouTube: Chromecast has YouTube's own receiver; launching it with the video id is YouTube
  playing itself (check terms before), never our relay of YouTube audio. Spotify: Connect (Premium, later). The LAN
  server binds to the LAN interface only, refuses everything but the current token.
- **Needs**: nothing for local; personal servers for them.
- **Effort**: L. **Risk**: device quirks (format support: send MP3 / FLAC as is, no transcoding at first), firewall
  prompts (Windows asks once: say why before).
- **Done when**: a local FLAC plays on a DLNA speaker and a Chromecast, seek and volume work, the queue follows, the
  LAN server stops when casting stops.

## Listen together on the local network

- **Sees**: Share › Listen together: a 6-digit code (like Sync Mode); friends on the same network join and hear the
  same song at the same moment on their own PC; the host's queue, everyone can suggest songs.
- **How**: the `nearby` connector already pairs with a code. Session messages: song id (matched per PC through
  `matching`: each plays its own copy, YouTube or local), position, play / pause, with clock sync (NTP-like
  ping exchange, then target time). Followers correct drift by small seeks (> 150 ms) or rate nudges on native.
- **Rules**: each PC plays from its own legal source (no audio sent between PCs). Code-based pairing, nothing over
  the internet (remote later, with the user's OK on a relay).
- **Needs**: nothing.
- **Effort**: M-L. **Risk**: YouTube's start latency (ads blocked, buffering): start everyone at a shared future time.
- **Done when**: two PCs stay within 100 ms over a 4-minute song; leave / rejoin; a song missing on one PC is said.

## Phone remote

- **Sees**: Settings › Phone remote: a QR code; the phone opens a page (no app to install) with the cover, play /
  pause / next / seek / volume, Up next, search and add to queue.
- **How**: an HTTP + WebSocket server in Rust on the LAN (port chosen, LAN interface only), serving a tiny static
  page built with the site's tooling or plain HTML in `src-tauri/remote/`. Pairing token in the QR (rotated each
  time the page is opened from Settings); state pushed over the socket from the player store.
- **Rules**: off by default; only the LAN; token required; no library data beyond what the page shows; "Stop" in the
  tray. Covers through a proxy path on the same server (the phone can't use the `art` scheme).
- **Needs**: nothing.
- **Effort**: M. **Risk**: Windows firewall prompt (explained before), phones on guest Wi-Fi (say so).
- **Done when**: Android and iPhone browsers control playback; token wrong = refused; server off when the setting is.

## Batch tag editor + MusicBrainz

- **Sees**: select several local songs › Edit info: shared fields (album, album artist, year, genre, cover) edited
  once, per-song ones (title, track number) in a grid; "Find on MusicBrainz" proposes the release (tracks matched by
  duration), the user accepts.
- **How**: extend `src-tauri/src/tags.rs` and `music_core::local::write_tags` (TagEdit with more fields, many files
  in one command, async, progress events). MusicBrainz: `musicbrainz.org/ws/2/` search by artist + album, release
  lookup with recordings; Cover Art Archive for the front cover. Required User-Agent "Legato/x (repo URL)", 1 request
  per second.
- **Rules**: the user's files only. Undo: the old tags kept in SQLite until the next app start (one-step undo).
  Privacy row: "artist and album names to MusicBrainz when you look them up".
- **Needs**: nothing.
- **Effort**: M. **Risk**: tag formats (ID3v2.3 / 2.4, Vorbis, MP4): `lofty` handles them; test each.
- **Done when**: 12 songs of an album tagged in one go from MusicBrainz, covers embedded, library rows follow, undo.

## ReplayGain / loudness normalisation for local files

- **Sees**: Settings › Playback › Same loudness: Off / Track / Album (album keeps the album's own dynamics).
- **How**: read REPLAYGAIN_* tags (and R128 gain for Opus) during the scan (`music_core::local`); songs without them:
  measured in the background with the BS.1770 meter already in `crates/dsp` (integrated loudness + true peak), stored
  in SQLite. `crates/player` applies the gain before the chain, the limiter catches peaks. Adaptive Sound stays the
  live option for streams.
- **Rules**: none.
- **Needs**: a library migration (gain columns).
- **Effort**: M. **Risk**: background CPU on a big library (low priority thread, paused while the app plays heavy
  effects).
- **Done when**: two songs at -6 and -14 LUFS sound equal in Track mode (measured in a test), album mode keeps the
  difference inside an album.

## EQ per output device + AutoEQ

- **Sees**: the Live Editor remembers a preset per output device ("Headphones: Sennheiser HD 600 profile", "Speakers:
  flat"); a headphone picker with AutoEQ's corrections.
- **How**: device id from WASAPI (`cpal` device name + id), a map device → preset in settings. AutoEQ: its results are
  parametric EQ text files (MIT-licensed data, not code): ship a compact index of popular headphones or fetch one
  file on demand from GitHub raw; convert to our `eq` bands or add parametric bands to `crates/dsp` (biquad peaking
  already exists). YouTube's twin (`live.js`) gets the same filters.
- **Rules**: AutoEQ's licence (MIT) noted in third-party notices if data is shipped. Privacy row if fetched.
- **Needs**: device switching ([last-batch.md](last-batch.md) › Output devices).
- **Effort**: M. **Risk**: parametric vs 10-band approximation (go parametric: 10 peaking filters + shelves).
- **Done when**: plugging headphones swaps the preset within a second, both twins sound the same (formula test).

## Exclusive WASAPI / bit-perfect

- **Sees**: Settings › Playback › Output: Shared (default) / Exclusive (local files and servers: the device at the
  file's own rate and depth, nothing else can play meanwhile; effects and volume off unless asked).
- **How**: `cpal` exposes WASAPI shared only; exclusive needs our own WASAPI client (windows crate: `IAudioClient`
  with `AUDCLNT_SHAREMODE_EXCLUSIVE`, event-driven, format negotiation, fall back on refusal). In `crates/player`, a
  second output backend. Volume in exclusive = the device's (endpoint volume) or digital with dither.
- **Rules**: none; YouTube stays in WebView2 (unchanged).
- **Needs**: nothing.
- **Effort**: L. **Risk**: device quirks, glitches on sample-rate switches between songs (gapless across rates is
  impossible: say so).
- **Done when**: a 24/96 FLAC reaches a USB DAC at 96 kHz (the DAC shows it), switching songs at another rate works.

## Album-aware gapless and crossfade

- **Sees**: crossfade never cuts inside a continuous album (live albums, DJ mixes, concept albums) or between two
  tracks of the same album played in order; Settings › Playback › Crossfade › "Not within albums" (on by default).
- **How**: rule in the fade planner (`features/player/fade.ts`, `ends.ts`): same album id + consecutive track numbers
  → no crossfade, gapless (native) or immediate start (YouTube). Detect "continuous" (no silence at the boundary,
  from the live meter / file analysis) to apply it even to compilations.
- **Rules**: none.
- **Needs**: track numbers stored (local yes; YouTube albums via `album_info`).
- **Effort**: S. **Risk**: none.
- **Done when**: Pink Floyd's side of an album plays without dips, a playlist of singles still crossfades (unit tests on
  the planner).
