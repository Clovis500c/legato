# 1. Catch up with Riff

What a Riff user would look for in their first hour. Riff (rootscripts/riff): Electron, YouTube Music / YouTube /
SoundCloud through yt-dlp, imports from Spotify, Apple Music, Deezer, YouTube Music, SoundCloud.

## Deezer playlist / album link

- **Sees**: pastes `deezer.com/…/playlist/…` or `/album/…` (or a `link.deezer.com` short link) in Add music or the
  search box; the same import dialog as a Spotify link: name, cover, "12 of 13 found", Import.
- **How**: new `crates/connectors/src/deezer.rs`: Deezer's public API (`api.deezer.com/playlist/{id}`,
  `/album/{id}`, paginated `tracks?index=`), no key. Each track has ISRC (album tracks: one call per track or the
  album's `tracks` with `isrc` when present), title, artist, duration: straight into `music_core::matching` (ISRC
  first). Short links: follow one redirect in Rust. Shell command beside `import_spotify_link` (async). UI:
  `features/add/kind.ts` recognises the URL, reuses the Spotify import dialog.
- **Rules**: metadata only (no Deezer audio, its 30 s previews unused). Website privacy row: "api.deezer.com when you
  paste a Deezer link". `art` scheme allowlist: Deezer's cover host (`e-cdns-images.dzcdn.net`, `cdn-images.dzcdn.net`).
- **Needs**: nothing.
- **Effort**: S. **Risk**: Deezer rate limit (50 requests / 5 s): batch, back off on `quota` errors.
- **Done when**: a public playlist of 150+ songs imports with pagination; mockito tests on recorded answers (playlist,
  album, short link, private playlist error in plain words); the paste box shows Deezer's icon.

## Apple Music playlist / album link

- **Sees**: same flow with `music.apple.com/{country}/album/…` or `/playlist/…`.
- **How**: albums: iTunes Lookup (`itunes.apple.com/lookup?id=…&entity=song`, already used by
  `crates/connectors/src/itunes.rs`), no key. Playlists have no keyless API: read the page's embedded data (the
  `serialized-server-data` JSON in the HTML of the public playlist page), titles, artists, durations, ISRC when given.
  Parser in `itunes.rs`, defensive (fields optional), with a test on a saved page.
- **Rules**: metadata only. Privacy row: "music.apple.com / itunes.apple.com when you paste an Apple Music link".
- **Needs**: nothing.
- **Effort**: S for albums, M with playlists. **Risk**: the page format changes (unofficial, like InnerTube): fail in
  plain words ("Apple changed its page: paste the songs as text instead") and point to Import a list of songs.
- **Done when**: album and public playlist import, editorial playlists too (`pl.` ids); tests on saved answers.

## Connect Spotify

- **Sees**: Add music › Connect Spotify. Spotify's own page opens in an app window, any free account signs in. Legato shows
  the playlists and Liked Songs with covers and counts; ticks some; Import, "120 of 300", Cancel. A second import refreshes.
- **How**: `spotify_web.rs` already opens the signed-in player in its own window, sign-in on Spotify's page, cookies in
  WebView2. A script there opens each list and reads the rows it draws (`data-testid="tracklist-row"`: title, artists,
  album, duration, `/track/` link), scrolling at a person's pace (the list is virtual: 25 rows drawn of 50). The songs
  reach `links.rs`' matching. To design: how they get back, as that window has no IPC on purpose (a capability scoped to
  one command, or Rust reading WebView2's own view of the page). Liked Songs is `/collection/tracks`; the list of
  playlists comes from the sidebar. Both unchecked: signed-in pages need the user's account.
- **Rules**: never the token, never the TOTP, no request of our own to Spotify, no cookie read beyond "signed in", nothing
  sent anywhere. Metadata only. Spotify's User Guidelines ban scraping and can close an account: the app says so before
  the first import, in plain words. Privacy row. The user's go first, noted in CLAUDE.md.
- **Needs**: the matching of `links.rs`; "paste" below as the fallback when the page changes.
- **Effort**: M-L. **Risk**: the user's account (no ban found, none ruled out); selectors that change (fail in plain words,
  point to the guided copy).
- **Done when**: a free account imports a private playlist and Liked Songs, 300 songs, by clicks alone.

## Spotify private playlists and Liked Songs, free

- **Sees**: Add music › Spotify: selects all in Spotify's desktop app, copies, pastes into Legato; or opens Spotify's data
  export. The songs come in as playlists of theirs, playing through the usual matches. No key, no Premium, no sign-in.
- **How** (paste): a block of `open.spotify.com/track/…` lines (or `spotify:track:` URIs) recognised in Add music and by
  Ctrl+V. `spotify_embed.rs`: `parse_link` takes tracks too, `open.spotify.com/embed/track/{id}` gives `title`, `artists`,
  `duration` in `__NEXT_DATA__` (read on a real track 2026-10-31; no ISRC, so title + artist + duration matching). Few at
  a time, retries, progress and Cancel as in `links.rs`. Spotify's own clipboard gives no playlist name: ask for one.
- **How** (export): the zip or `Playlist1.json` opened in Add music; each playlist under its name. Field names from a
  real export, none at hand yet. `YourLibrary.json` for Liked Songs if it holds them.
- **Rules**: metadata only. No sign-in, no cookie, no token; the web session stays out (`docs/playback.md` › Spotify
  without keys: its token needs a secret hidden in the player's code, the user said no on 2026-10-16). Privacy row:
  the embed page is already listed for public links, say it now serves pasted songs too. Secrets: none.
- **Needs**: nothing. **First**: try the copy on the user's PC. The guide found is a community moderator's, undated; a
  thread says pasting several links *into* a playlist broke once, which isn't our direction.
- **Effort**: M (paste), S-M (export). **Risk**: a rate limit on many embed pages (unknown; one real request gave a 504);
  a change of the clipboard format or of the embed page; the export may leave private playlists out.
- **Done when**: a 300-song private playlist and Liked Songs imported from a free account; mockito tests on saved pages.

## SoundCloud link

Terms read 2026-10-31, before anything else here: the [API terms](https://developers.soundcloud.com/docs/api/terms-of-use)
bar scraping, ask for a registered app and bar a playback experience that mixes SoundCloud's content with other services'
(so a widget beside YouTube, even official, is doubtful). The site's terms restrict players used to build a streaming
service: only a summary was read, the page doesn't load outside a browser. Order: metadata import first, like Deezer;
playback only on the user's go, after reading the full text.

- **Sees**: pastes a SoundCloud track, playlist ("set") or user likes link; the songs come in like a Spotify import,
  and SoundCloud-only tracks (remixes, unreleased) play from SoundCloud itself.
- **How**: oEmbed (`soundcloud.com/oembed?url=`) gives the title and the widget URL without a key. A set's track list
  comes from the widget's API (`SC.Widget(iframe).getSounds()`) inside a hidden widget page, or from the page's
  hydration JSON. Matching first (YouTube / local), SoundCloud as the source only when nothing matches. Playback: a
  new player kind in `features/player/` beside `youtube.ts`, the official widget iframe (`w.soundcloud.com/player`),
  its JS API for play / pause / seek / position / finish, its volume for fades. Shield allowlist for the widget host.
- **Rules**: the widget is SoundCloud's own player (legal, like YouTube's embed); never its stream URLs. The widget
  shows SoundCloud's branding: keep it visible somewhere (Now Playing), like the YouTube video rule. Check the
  widget's terms on hidden players before a Cover-only mode. Privacy row.
- **Needs**: a source id `soundcloud` in `music_core::model::Source` (library migration, `SCHEMA_VERSION`), its icon.
- **Effort**: L (new source end to end). **Risk**: widget throttling, tracks blocked from embedding (fallback: open
  on SoundCloud).
- **Done when**: a set imports, an unmatched track plays through the widget with fades, media keys and the Windows
  panel; position saved with the session.

## SoundCloud search

- **Sees**: a SoundCloud row in Search (tracks, sets, artists) beside YouTube's, hidden by default (Settings ›
  Sources).
- **How**: no keyless public search API. Options: the web client's `api-v2` with the client id the site itself
  serves (read from its JS, like InnerTube; unofficial), or skip search and keep links only. Decide with the user.
- **Rules**: unofficial like InnerTube (user's choice needed, noted in CLAUDE.md if taken). Privacy row.
- **Needs**: SoundCloud link (above).
- **Effort**: M. **Risk**: client id rotation, terms.
- **Done when**: user's go, results play through the widget, search suggestions untouched.

## Karaoke / TV mode

- **Sees**: a Karaoke button on the lyrics panel and Now Playing (and a shortcut, K): full screen, the current line
  big and centered, the next two dimmed below, the past one fading above, the blurred cover behind
  (`immersive.ts`), title / artist / progress small at the bottom. Plain lyrics scroll slowly with the song.
- **How**: a new view in `features/player/` reusing `lyricsAt.ts` (line at time), the offset / rate fix of
  `LyricsPanel.tsx`, `app/fullscreen.ts`. Lines animate with transforms only. Arrow keys nudge the offset; Esc leaves.
  Optional "sing along": the Live Editor's vocal cut is not available (no stems), so no promise of instrumental.
- **Rules**: none new. Reduced motion: no zoom, just a cross-fade.
- **Needs**: nothing; word-by-word lyrics (indie.md) makes it better later.
- **Effort**: S. **Risk**: none.
- **Done when**: works on YouTube and local, survives a song change (next song's lyrics load behind), 60 fps on the
  bench PC, keys listed in Settings › Shortcuts.

## Lyrics translation

- **Sees**: a Translate button in the lyrics panel: each line with its translation under it (to the interface
  language), or translation only.
- **How**: needs a translation service. Keyless options are unofficial (Google's web endpoint) or rate-limited
  (LibreTranslate public instances, MyMemory: 5 000 chars / day anonymous). Best: MyMemory or LibreTranslate with an
  optional user key in the keychain, lines batched, cached per song + language in SQLite (beside the lyrics cache).
  Rust connector `translate.rs`, mockito tests.
- **Rules**: sends lyrics text out: privacy row "the lyrics of the song you translate, to {service}". Off until asked
  per song (no automatic sending).
- **Needs**: nothing.
- **Effort**: M. **Risk**: quality, quotas; language detection (the service's).
- **Done when**: a French user translates an English song, the result is cached (second open = no request), quota
  errors in plain words.

## App colours from the cover

- **Sees**: Settings › Appearance › "Colour from the playing cover": the accent, page bands, sidebar tint and
  selection take the cover's colours, fading between songs.
- **How**: `coverTint.ts` already extracts a tint. Extend to a small palette (dominant, vibrant, muted) and feed
  `shared/theme/theme.ts` variables at runtime (no settings write per song). Contrast guard: ink stays AA on the
  tinted surfaces (`contrast()` exists in theme.ts); fall back to the theme's colours when a cover is grey.
- **Rules**: the brand guard keeps Legato's logo colours (`data-brand`). Default look (design.md) stays: this is an
  opt-in.
- **Needs**: nothing.
- **Effort**: S-M. **Risk**: flashing on fast skips (debounce, 600 ms cross-fade).
- **Done when**: on in light and dark, AA checked by a unit test on a set of covers' palettes.

## Squiggly / waveform progress bar

- **Sees**: Settings › Appearance › Progress bar: Line (today), Squiggle (a wave that moves while playing, flat when
  paused), Waveform (local files: the song's real shape; streams: falls back to Squiggle).
- **How**: `Progress.tsx` already draws at 60 fps: add an SVG path or canvas variant. Waveform: computed once per local
  file in `crates/player` (peaks per 1/500 of the song while scanning or on first play), stored in SQLite (small
  blob), sent with the track.
- **Rules**: waveform only from the user's files (computing it for streams would mean taking their audio).
- **Needs**: nothing for Squiggle; a migration for waveforms.
- **Effort**: S (squiggle), M (waveform). **Risk**: seek precision with a wavy target (hit area stays a straight band).
- **Done when**: three styles, seek and drag unchanged (`seekDrag.ts` tests pass), waveform cached across restarts.

## More visualizers

Detailed in [visualizer.md](visualizer.md) (styles, full screen).
