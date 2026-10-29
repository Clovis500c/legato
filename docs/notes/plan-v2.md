# Music App: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign's steps, the user's choices along the way) is in git:
`git log -p docs/notes/plan-v2.md`, and in the release notes.

## Version 1.0: the redesign (branch `v2`)

Direction: [design.md](../design.md). Mockups: Figma file "Untitled" (every page in light and dark, the website too).
Version 1.0 (user's choice 2026-10-29: the first releases were 0.1). A new session starts with
[v2-handoff.md](v2-handoff.md).

- [x] Done on `v2`: palettes and defaults v8, layered panels, two-panel sidebar, right panel (Up next, lyrics, the
      mini player on top), song rows (artist column, heart, covers), page bands in the cover's tint, Now Playing, Up
      next in three blocks saved with the session, Home, Search, notifications setting, the mockup pass, motion, the
      website (`site/`), docs cleaned up.
- [ ] Your library ↗ (open it full width, design.md), and the player bar's "artist · from your file" line.
- [ ] Check in the app: "No sound could be taken" gone from the second YouTube video on (fix 51946d5).
- [x] Website on GitHub Pages (user's choice 2026-10-29): Pages on, source GitHub Actions; `pages.yml` deploys `site/`
      from `master` at https://clovis500c.github.io/music-app/ (first deploy with the merge).
- [ ] Merge `v2` into `master` and push (= release v1.0.x): only when the user says.
- [x] Name: Legato, with Figma's brand (01 Brand: Roboto Black wordmark, the L on the playback blue), user's choice
      2026-10-29. The website uses it.
- [ ] The app itself still says Music App (window, installer, top bar, About, texts, icon): rename on the user's go.
      Never rename the identifier, `_musicapp._tcp`, `MA1` or keychain entries; a new productName moves the install
      folder (check the updater first). Trademark search (INPI, EUIPO, USPTO classes 9, 41, 42) still to do.
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).

## Check live in the real app (built and unit-tested, never driven for real)

- [ ] Add to a YouTube Music playlist from an album page (cause of `STATUS_FAILED` assumed = duplicates); toasts + Undo
      / Add anyway; advanced fade by ear (curves, fade on skip, fade on pause); Home's YouTube Music shelves on a real
      account (unofficial API); Home items not in the library; new mixes after real listening; exact restore after an
      update.
- [ ] Tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user owns, blocked video falling
      back, Auto on a real music video, resume after a real restart, sort Most played.
- [ ] Repeat one / repeat all at a track's end, menu actions that write (rename, delete, export, remove from playlist),
      local file covers, Apple cover backfill, Spotify covers, add another Google account, sign out.

## Not done yet

- [ ] Media panel off Windows.
- [ ] Spotify previews.
- [ ] Mixes: genre / year tags (not stored yet), Last.fm "Discoveries" (user's key); "Never in mixes" on a discovered
      song (not in the library: no row to hold the choice).
- [ ] Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
- [ ] Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
      clicked in a browser (deep-link registration).
- [ ] Bonus list (pick): equalizer (local files).

**Spotify** (no keys; the user chose link import)
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: private playlists and Liked Songs (web session), ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- [ ] Local only: `ui/dev/` preview harness (excluded in `.git/info/exclude`), delete when no longer useful.
- Dependabot alert #1 (`glib` 0.18, Linux only, through Tauri's GTK3 stack) dismissed: re-check at each Tauri upgrade.

## Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
- No circumventing Premium or DRM. Quotas respected, no server of ours.
