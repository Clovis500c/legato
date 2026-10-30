# Ideas loved in independent players

From Riff, Plexamp, Spicetify, YouTube Music Desktop (pear-desktop), Cider, MusicBee, foobar2000, Guayadeque.

## Skip non-music parts of music videos (SponsorBlock)

- **Sees**: Settings › Playback › Skip non-music parts: intros, skits, talking, outros in music videos skipped
  automatically, with a small "Skipped intro (0:24) · Undo" notice; a marker on the progress bar.
- **How**: SponsorBlock's public API (`sponsor.ajay.app/api/skipSegments?videoID=…&categories=["music_offtopic"]`),
  or the privacy-preserving hash prefix form (`/api/skipSegments/{sha256 prefix}`: only 4 hex chars of the id's hash
  sent). Rust connector `sponsorblock.rs`, cached per video in SQLite. The YouTube player seeks past segments
  (`youtube.ts`); crossfades treat a segment at the end as the end (`ends.ts`).
- **Rules**: hash-prefix requests (the video id never sent). Privacy row. Off by default? Ask the user; on by default
  is what users of pear-desktop expect.
- **Needs**: nothing.
- **Effort**: S. **Risk**: wrong segments (community data): Undo jumps back and remembers "don't skip on this video".
- **Done when**: a music video with a known intro starts at the music; mockito tests with recorded answers.

## Skip silences

- **Sees**: Settings › Playback › Skip silence at the start and end of songs.
- **How**: local: measured when scanned (first / last sample above -60 dBFS), stored; start offset and early end applied
  by the player. YouTube: the live meter already learns early ends (`ends.ts`); for starts, seek after the first
  second of silence measured live.
- **Effort**: S. **Done when**: a file with 5 s of leading silence starts on the music.

## Precise volume

- **Sees**: mouse wheel over the player bar (or the volume slider) changes volume in 1 % steps (Shift: 5 %), a number
  shown while changing; Ctrl+Up / Down keys; volume remembered per source if wanted.
- **How**: `PlayerBar.tsx` wheel handler, actions in `keys.ts`. Curve: perceptual (dB) mapping for the slider.
- **Effort**: S. **Done when**: wheel works over the whole bar, not only the slider; keys rebindable.

## Word-by-word lyrics

- **Sees**: the lyrics panel and karaoke light each word as it's sung (Apple-style), background vocals smaller and
  apart, duet sides left and right.
- **How**: enhanced LRC (`<mm:ss.xx>` per word) when LRCLIB or a local `.lrc` has it; otherwise lines only. Parser in
  `music_core::lyrics`, rendering with a CSS gradient mask per word (transform-only animation).
- **Effort**: M. **Risk**: few sources have word timings; don't fake them (no guessed word timing by default).
- **Done when**: an enhanced LRC file animates per word; plain LRC unchanged.

## Sweet fades

- **Sees**: crossfade "Smart": length and shape picked per pair (quiet outro + quiet intro = long fade; hard ending =
  short or none; songs in the same album = gapless).
- **How**: `fade.ts` planner gets each song's end and start loudness profile (local: measured at scan; YouTube: learned
  live and stored per song) and tempo; a small rule table, unit tested.
- **Effort**: M. **Done when**: tests on planner inputs; by ear on a mixed playlist.

## A path between two artists

- **Sees**: Mixes › Journey: pick a start song and a destination song; a mix of 20 songs walking from one to the other.
- **How**: a similarity graph from sonic features + co-listening (`mixes.rs` already builds a session graph); path by
  interpolating feature vectors and picking nearest unused songs at each step (library + YouTube Music radio
  candidates).
- **Needs**: sonic analysis.
- **Effort**: M. **Done when**: the path's feature distance falls steadily (test on a synthetic library).

## Guest DJ-style picks

- **Sees**: an optional "DJ" voice-less mode: between songs, a line in Up next says why the next one was picked ("you
  played this a lot in March", "same producer", "faster, like you've been skipping slow ones").
- **How**: the reasons the mixes engine already uses (scores, flows), exposed as text through `msg` tables (i18n).
- **Effort**: S-M. **Done when**: every auto-picked song has a reason in both languages.

## Auto-DJ with rules

- **Sees**: Auto-DJ: keep the queue going from the library with rules (genres, ratings, not played in N days, max per
  artist), like MusicBee.
- **How**: smart playlist rules (`rules.ts`) as the source, smart shuffle as the order, refill at 3 songs left.
- **Needs**: smart shuffle; genre / rating fields make it richer.
- **Effort**: S.

## App colour from the cover

Detailed in [catch-up.md](catch-up.md) › App colours from the cover.

## Picture-in-picture

- **Sees**: a small always-on-top window with the video (or cover) and play / next; resizable, snaps to corners.
- **How**: the floating mini player exists (`MiniPlayer.tsx`, `snap.ts`): make it a separate always-on-top Tauri
  window, YouTube embed moved there while it's open (one embed at a time: hand the player over with position).
- **Rules**: video visible (the 200×200 minimum stays).
- **Effort**: M. **Risk**: moving the embed between windows restarts it (accept a short rebuffer, or keep the main
  embed and mirror only the cover).
- **Done when**: PiP over a full-screen game window on a second monitor, controls work.

## Classic compact layout and column view

- **Sees**: View › Compact: a small Winamp-like strip (title scroller, transport, tiny visualizer) in the theme;
  Library › Columns: pick columns (title, artist, album, year, genre, plays, rating, added, duration, bitrate,
  source), sort by several, group by album or artist with headers (foobar2000 / MusicBee).
- **How**: compact = a window size preset with its own layout; columns = `TrackTable.tsx` with a column model saved in
  settings (virtualized already).
- **Effort**: M. **Done when**: 50 000 rows scroll at 60 fps with 10 columns and grouping.

## Lyrics saved into files and timed live

- **Sees**: Edit lyrics in the panel: fix a word, add missing lyrics; Sync mode: play the song and tap Space at each
  line to time it; save into the file's tags (local) or our cache (streams).
- **How**: `USLT` / `SYLT` (ID3) or `LYRICS` (Vorbis) via `lofty`; our edits in SQLite override LRCLIB's.
- **Effort**: M. **Done when**: a tapped LRC saved into an MP3 shows in another player.

## ListenBrainz scrobbling

- **Sees**: Settings › Accounts › ListenBrainz: paste the user token; scrobbles and now playing sent like Last.fm.
- **How**: `crates/connectors/src/listenbrainz.rs` (`/1/submit-listens`, token header), token in the keychain; reuse
  Last.fm's rules (`lastfmRules.ts`: half the song or 4 minutes).
- **Rules**: privacy row.
- **Effort**: S. **Done when**: mockito tests; listens appear on the user's profile.

## Ratings

- **Sees**: stars (half stars optional) in song rows and info; smart rules and Auto-DJ on rating; Sync Mode carries
  them; written to local files (POPM / RATING) when the user allows.
- **How**: a column (migration), UI in `TrackTable.tsx`, `rules.ts` field.
- **Effort**: S-M. **Done when**: a rating set on PC A shows on PC B; the file tag readable by MusicBee.

## Sonic analysis, ours and local

- **Sees**: "Similar songs" on any song, better radio and mixes, BPM / key / energy in song info, Journey and sweet
  fades possible.
- **How**: features per song: tempo, key (chroma + key profiles), loudness, dynamic range, brightness (spectral
  centroid), energy, "danceability" (beat strength), vocal presence (a simple band ratio), a small embedding vector
  (MFCC means and variances). Local files: analysed in the background (decode with symphonia, 30 s from the middle).
  Streams: from what plays live (the `crates/dsp` meter path / `live.js` analyser), averaged over the play and stored
  per song. Similarity = cosine on normalised features. `crates/dsp/src/features.rs` pure and tested.
- **Rules**: measured from playback or the user's files, never fetched or extracted from a platform; stays on the PC
  (synced by Sync Mode).
- **Needs**: library migration (features table).
- **Effort**: L. **Risk**: quality with simple features (fine for "similar energy and tempo"; not genre magic).
- **Done when**: on a 500-song test library, the 10 nearest songs of a song share tempo ±8 % and energy band in 80 %
  of cases.

## Describe a playlist in words

- **Sees**: Mixes › Describe: "calm rainy Sunday, no lyrics" → a playlist from your library and discoveries.
- **How**: local first: a keyword map (calm → low energy, rainy → minor key + slow, no lyrics → low vocal presence,
  decades, genres) over tags and sonic features. Optional LLM with the user's own API key (keychain): the model turns
  the sentence into rules (structured output), never sees the library beyond what's sent (only the request text).
- **Rules**: LLM off unless a key is set; privacy row naming the provider; the user's choice needed before building
  the LLM path.
- **Needs**: sonic analysis.
- **Effort**: M (local), S more for the LLM path.
- **Done when**: 20 sample sentences give sensible rule sets (tests on the keyword parser).

## Bookmarks inside a song

- **Sees**: B (or a button) marks the moment; marks on the progress bar, a list in song info with notes; click to jump.
- **How**: a table (song key, ms, note), synced by Sync Mode; marks drawn by `Progress.tsx`.
- **Effort**: S.

## Practice mode for musicians

- **Sees**: Practice panel: A-B loop (set by keys or drag on the bar), speed without pitch change (Live Editor's
  tempo), pitch shift in semitones, the song's key and detected chords on a timeline, a count-in and a metronome
  click on the beat.
- **How**: loop in the player (native: sample-exact; YouTube: seek at B with a short fade); chords: chroma per beat +
  templates (pure Rust, from local files or live); metronome from beat detection, clicks mixed by the native chain /
  `live.js` (a click generator).
- **Effort**: M-L. **Risk**: chord detection accuracy (mark as "estimated").
- **Done when**: a loop of 4 bars repeats without a gap on a local file; metronome stays on the beat over 2 minutes.

## Full cover display

- **Sees**: View › Cover: the cover huge, title, artist and a thin progress over it, optional clock; ideal on a second
  screen.
- **How**: a Now Playing variant (immersive backdrop exists), its own window option for a second monitor.
- **Effort**: S.

## Discovery from open sources

- **Sees**: Home › Discover: new releases from followed artists, picks from music communities (r/listentothis' top of
  the week), each a card to play (found on YouTube).
- **How**: Reddit's public JSON (`/r/listentothis/top.json?t=week`, User-Agent required; titles are "Artist -- Title
  [genre] (year)"), parsed in Rust, matched through the songlist parser (`songlist.rs`).
- **Rules**: privacy row; Reddit's API terms for unauthenticated reads (rate limits: once a day).
- **Effort**: S-M. **Done when**: a weekly shelf with 25 playable songs.

## Aural fixations

- **Sees**: Home card: "You played this a lot in March 2024" with the songs of that period you no longer play.
- **How**: history bucketed by month; songs with a strong peak then silence; pure in `mixes.rs` or a new
  `history` helper, tested.
- **Needs**: a year of history (Last.fm import can seed it).
- **Effort**: S.
