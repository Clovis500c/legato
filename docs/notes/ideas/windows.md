# 4. Small things on Windows

Each one small; together a reason to keep Legato open all day.

## Command palette (Ctrl+K)

- **Sees**: one box over everything: type to find a song, album, artist, playlist, page, setting or action ("shuffle
  liked", "sleep 30", "dark theme"); Enter plays / opens / runs; Tab narrows to a kind.
- **How**: sources already exist: library search (`crates/core/src/search.rs`), settings index
  (`features/settings/search.ts`), actions table (`app/keys.ts`). A palette component in `shared/ui/` ranking them
  with one fuzzy scorer (pure, tested), recent picks first. Shortcut added to the actions table (rebindable).
- **Rules**: setting ids stay English; labels translated.
- **Needs**: nothing.
- **Effort**: S-M. **Risk**: none.
- **Done when**: every action of `keys.ts` and every settings row reachable; 10 000-song library answers in < 30 ms.

## Jump List

- **Sees**: right-click Legato's taskbar button: Play / Pause, Shuffle all, Liked songs, the last 5 playlists.
  (Thumbnail buttons already exist: `thumbbar.rs`.)
- **How**: `ICustomDestinationList` (windows crate) with tasks launching `legato.exe --action …`; the single-instance
  handler forwards the action to the running app. Recent playlists refreshed when played.
- **Rules**: none.
- **Needs**: the single-instance argument path (check `main.rs`).
- **Effort**: S. **Risk**: none.
- **Done when**: each entry works with the app running and closed (starts it, then acts).

## Pause on unplug and during calls

- **Sees**: headphones unplugged or Bluetooth dropped → pause (Settings › Playback, on by default); a Teams / Discord
  call starts → lower or pause (Windows' "communications" ducking), resume after.
- **How**: device changes: `IMMNotificationClient` (default device changed / state changed) in Rust; if the device we
  played on is gone → pause event. Calls: Windows ducking events (`IAudioSessionControl2` + ducking notification
  `IAudioVolumeDuckNotification`) on our sessions, for native and the WebView2 sessions (`mixer.rs` already finds them).
- **Rules**: none.
- **Needs**: nothing.
- **Effort**: S-M. **Risk**: WebView2 keeps playing YouTube on the new default device before we pause (pause fast,
  < 200 ms).
- **Done when**: on a real Bluetooth headset off / on, and a Teams test call.

## Pick up on the other PC

- **Sees**: on PC B, a card "Continue from Desktop: Song at 2:31"; one click plays from there. PC A pauses if still
  playing (when both are on the LAN).
- **How**: Sync Mode carries a small "now playing" record (song key, position, queue, time) in each PC's sync file
  (`crates/core/src/syncmode.rs`); on the LAN, a direct message too (`nearby`). Card shown when it is newer than 1 day
  and the other PC's.
- **Rules**: sealed like the rest of Sync Mode when it travels.
- **Needs**: Sync Mode set up.
- **Effort**: S-M. **Risk**: OneDrive delay (minutes): LAN path first, folder as a fallback.
- **Done when**: two PCs: play on A, open B, continue; the queue matches.

## Alarm

- **Sees**: Settings › Alarm (or the tray): a time, days, a playlist or mix, fade in over N minutes, volume target;
  works with the window closed (tray mode); snooze from the Windows panel.
- **How**: timer in Rust (`background.rs` keeps the app alive in the tray); wakes the webview, starts the queue with
  a fade (`fade.ts`). PC asleep: `SetWaitableTimer` with resume (needs "Allow wake timers" in Windows' power plan:
  say so, don't change it).
- **Rules**: never change power settings ourselves (system settings are the user's).
- **Needs**: nothing.
- **Effort**: S-M. **Risk**: sleep / hibernate behaviour across PCs.
- **Done when**: alarm fires from the tray with the window hidden and from sleep on a PC with wake timers on.

## Focus and workout sessions

- **Sees**: Start a session: Focus (25/5 cycles, instrumental or calm mix, notifications at breaks) or Workout (a
  duration, high-energy mix, tempo rising); a summary after (time, songs).
- **How**: a small timer store like `sleep.ts`; mixes picked with tags / sonic features (instrumental = no lyrics
  found + sonic "speechiness" later). Summary saved in history.
- **Rules**: none.
- **Needs**: sonic analysis makes the mixes good; works with liked songs before.
- **Effort**: S. **Risk**: none.
- **Done when**: a 25-minute focus cycle runs with the break sound and resumes.

## OBS overlay for streamers

- **Sees**: Settings › Streaming overlay: a local URL to add as a Browser Source in OBS; shows cover, title, artist,
  progress, in the app's theme or a few layouts; transparent background.
- **How**: same LAN server as the phone remote (bound to 127.0.0.1 for this), a page receiving now-playing over a
  WebSocket. Layouts as CSS presets; the user's own CSS allowed.
- **Rules**: localhost only, off by default.
- **Needs**: the phone remote's server (share it).
- **Effort**: S once the server exists. **Risk**: none.
- **Done when**: OBS shows it, song changes animate, no CPU spike.

## Drag from Explorer

- **Sees**: dropping files or folders on the window adds them (folder = watched folder offer, files = added and
  played with Shift); dropping on a playlist adds there.
- **How**: Tauri's drag-drop event gives paths; `folders.rs` / `local` scan; drop targets in the sidebar (playlists).
- **Rules**: files only from the user's own drop.
- **Needs**: nothing.
- **Effort**: S. **Risk**: none.
- **Done when**: a folder, 3 files, and a drop onto a playlist all work; unsupported files said.

## Find a song by a line of its lyrics

- **Sees**: Search with quotes or a "Lyrics" tab: type a line, get songs.
- **How**: LRCLIB has a search endpoint (`/api/search?q=`) that matches lyrics text; results → YouTube / library
  matching. Local lyrics cache searched first (SQLite FTS on cached lyrics).
- **Rules**: privacy row ("the words you search, to LRCLIB" when used).
- **Needs**: nothing.
- **Effort**: S. **Risk**: LRCLIB coverage.
- **Done when**: 10 famous lines find their songs in a test with recorded answers.

## Hum to search

- **Sees**: Music Detector › Hum: hum or sing 10 s, get candidates.
- **How**: AudD's free tier is song recognition from recordings; humming needs their "humming" endpoint (check if it
  exists on the free tier). Otherwise skip.
- **Rules**: audio of the user's own voice, sent only when asked (Music Detector's existing privacy row).
- **Needs**: check AudD's offer.
- **Effort**: S if available. **Risk**: not available free: drop the idea.
- **Done when**: decided after checking.

## Credits and artist pages

- **Sees**: song info: written by, produced by, label, release date; artist page: a short bio, origin, years active,
  links (website, Wikipedia, Bandcamp).
- **How**: MusicBrainz recording relationships (work → writers, producers), Wikipedia REST summary
  (`/page/summary/{title}`, via Wikidata from the MBID). Cached in SQLite.
- **Rules**: privacy rows; Wikipedia text is CC BY-SA: show the source link and licence line.
- **Needs**: MBIDs (from tag lookups or search by name).
- **Effort**: M. **Risk**: wrong artist on common names (match by MBID only, show nothing otherwise).
- **Done when**: 20 well-known artists show the right bio; credits for tagged local albums.

## Playlist folders, pins, generated covers

- **Sees**: folders in the sidebar (drag playlists in), pin a playlist to the top, playlists without a cover get a 2×2
  of their first songs' covers (`PlaylistCover.tsx` exists: check what it does today).
- **How**: folders stored locally (settings or a table), synced by Sync Mode; YouTube Music has no folders (local only).
- **Rules**: none.
- **Needs**: nothing.
- **Effort**: S. **Risk**: none.
- **Done when**: folders survive restarts and sync to the other PC.

## Same loudness across sources

- **Sees**: switching from a YouTube song to a local file doesn't jump in volume (Settings › Playback › Same loudness
  covers every source).
- **How**: Adaptive Sound already measures live (both twins). Use its integrated measure per song to set a gain for the
  next play (stored per song), plus ReplayGain for files: every song lands near the target LUFS.
- **Rules**: live processing (allowed).
- **Needs**: ReplayGain ([lead.md](lead.md)).
- **Effort**: S-M. **Risk**: first play of a song unknown (Adaptive Sound covers it live).
- **Done when**: a mixed queue measured within ±1 LU.

## Backup / restore

- **Sees**: Settings › General › Back up: one `.legato-backup` file (playlists, likes, edits, stats, settings, themes
  pictures); Restore merges or replaces. Secrets excluded unless sealed with a password.
- **How**: reuse Sync Mode's snapshot and sealing (`music_core::syncmode`), as a single file.
- **Rules**: sealing for secrets (same as Sync Mode).
- **Needs**: nothing.
- **Effort**: S. **Risk**: none.
- **Done when**: back up on PC A, restore on a fresh install, everything back.

## Hide explicit songs

- **Sees**: Settings › General › Hide explicit songs: filtered from search, mixes, radio; marked "E" otherwise.
- **How**: YouTube Music's explicit badge (in InnerTube answers), Spotify import's `explicit` flag, iTunes'
  `trackExplicitness`; stored per song.
- **Rules**: none.
- **Needs**: migration (explicit column).
- **Effort**: S. **Risk**: YouTube videos without the flag (can't be sure: said in the setting).
- **Done when**: an explicit song never shows in search with the setting on.
