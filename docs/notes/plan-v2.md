# Legato: plan

Open work only. Tick a line when it lands; drop ticked lines once a release ships them. Everything done before
(phases 1 to 8, the big update, the redesign, the product pass, roadmap milestones 0 to 2, the user's choices along the
way) is in git: `git log -p docs/notes/plan-v2.md`, and in the release notes.

Stable: 1.2.10 (2026-11-14). Next: the lines the owner chose on 2026-11-07 (their answers: Waiting on the user),
then milestone 3, Platforms; Against Liner 6 with the owner at the PC. Where the work stands: [handoff.md](handoff.md).

Every idea here stays: the user wants them all built in the end, just later (user's choice 2026-10-31). The roadmap sets
the order; a line leaves only when it ships or the user drops it.

## The owner's reports and asks of 2026-11-18

- [x] `M` Lyrics animations to improve (the owner, 2026-11-18; only noted, nothing built, no detail given yet): what to
      change is to ask them when it is taken (the line change, the word-by-word fill, the scroll between lines, the karaoke
      look, the backdrop under the lyrics?). Read first: the lyrics panel and `Karaoke.tsx` in `ui/src/features/player/`,
      their motion settings (`motion`, `backdropMotion`) and reduced motion; keep it cheap (no per-line filters, the owner's
      GPU driver has reset under load) and honour Windows' reduce-motion as the flowing backdrop does (`allowsMotion`).
      Done 2026-11-18: the panel now glides on a transform (FLIP) with Karaoke's recipe (`LEAD_MS`, `GLIDE`, `glideFrom` in
      `karaokeLines.ts`), both honour `allowsMotion`, a seek across the song jumps. NOT tried: a real song with real timed
      lyrics, light theme, 375 px, reduced motion on; word-by-word fill NOT built (the app keeps lines only, `Timed`).
      Decided alone (2026-11-18): no word fill, no new setting, no blur.

- [x] `M` A picture dragged from Discord (the owner, 2026-11-18; only noted, nothing built): Discord drops a link to its
      CDN (`cdn.discordapp.com`, `media.discordapp.net`; signed links that expire), not a file. Take it like a dropped
      picture, fetched in Rust, never by the page; what each kind is for (a shared card's code, a cover…) to settle when
      it is built. Also Legato's own files sent on Discord (the owner, same day): a `.lmix` (`music_dsp::lmix`), a
      `.legatosync` (`music_core::syncmode`) and any later kind, each then opened as the same file dropped from disk is,
      through the same checks (the `.lmix` reader's size cap, unknown fields refused, settings clamped); one that writes
      to the library (a sync file) asks first, and a stranger's never brings secrets. To make it safe (the owner: "well
      secured"): https only, those exact hosts, no redirect off them, a size cap per kind and a timeout, the kind taken
      from the content (image bytes, the file's own format), never from the name alone, nothing decoded before that
      check, the `Noted` resolver, nothing sent but the request itself; a new host, so the website's privacy rows first
      (`PRIVACY`, `SERVICES` in `site/components/content.tsx`).
      Done 2026-11-18: `crates/connectors/src/discord_file.rs` (check, fetch, kind from bytes), `src-tauri/src/discord_drop.rs`
      (`discord_take`: saves the file in the cache folder), `ui/src/features/library/discordDrop.ts`, a paste / drop listener
      in `PlayerBar.tsx`; the `discordapp.net` host in `netlog.rs` (Settings › Privacy), a "Files from Discord" row in `PRIVACY`.
      NOT tried: a real Discord drag, a real expiring link, a real `.lmix` posted on Discord; the website build (it stops on
      Next's own registry call, as before: only its tests and `tsc` ran).
      The drag may never reach the page: wry (0.57, `webview2/drag_drop.rs`) accepts file drags only and ignores a dragged
      text on Windows while Tauri's file drop is on, so a PASTE (Ctrl+V of the copied link) is the route that surely works; the
      `drop` listener is there for platforms that pass the text through. A real drag tells; if it fails, the fix is a native
      drop target in Rust (a bigger change), or an explicit "Paste a Discord link" button.
      Decided alone (2026-11-18): (1) no `.legatosync` kind: there is no drop route for one today (a sync file is one PC's file
      inside the shared folder, read by Sync Mode), so building one that writes to the library was out of scope: refused as
      "not a picture or a Legato file". (2) Attachment paths only (`/attachments/`), not avatars or emoji. (3) An explicit
      `:443` is accepted (the URL parser drops a default port), any other port refused. (4) No setting: nothing runs unless
      the user pastes or drops an exact Discord link, so no off-by-default switch; easiest to undo = delete the listener
      in `PlayerBar.tsx`. (5) A picture is only read for a share card's link (`share_read_image`), never kept as a cover.

- [ ] `M` Android: the sound sometimes crackles or sounds saturated (the owner, 2026-11-18, cause unknown to them, "maybe
      the connection"). Their answers: a YouTube song, Bluetooth earphones, the screen off or the app in the background, no
      effect on. Not reproduced. The owner's word (2026-11-18): fix the live processing so it holds up there; never
      switch it off to dodge the problem. Suspect first (read in the code, not proven): by default every YouTube song is
      listened to through Chromium's audio nodes, the phone too (`earlyEnds` on by default → `ends` in
      `player/liveSync.ts:55` → `live.js` `attach()` in listen mode: `captureStream`, an `AudioContext`, four 2048-point
      analysers and the K-weighting filters). A running context likely opens a sound output of its own, connected or
      not, beside the element's: two streams to the earphones from a background WebView, and Bluetooth (A2DP) wants
      steady buffers. Fixes to try, in order: the listening-only context rendered with no sound output
      (`new AudioContext({ sinkId: { type: 'none' } })`, Chromium 110 and later; older ones ignore the option), so the
      earphones get one stream; then the processing mode (`full`, the element muted) checked the same way. Each tried on
      the owner's phone, screen off, Bluetooth; the YouTube Music app on the same earphones tells whether Bluetooth
      alone crackles. A connection drop stalls or stops a song rather than crackling it.
      Built 2026-11-18 (NOT ticked: only the owner's phone can tell; nothing was run on Android): `live.js` makes a
      listening-only context with `sinkId: { type: 'none' }` (documented: MDN "AudioContext() constructor", Chrome blog
      "Change the destination output device in Web Audio", Chrome 110+; lore: that an unconnected context still holds an
      output stream and that a silent sink stops it; a third-party report says Chromium 154 and older give the silent sink
      the default device's parameters, 155+ paces it), the old constructor as fallback; the processing context is unchanged.
      On Android only: analysis every other tick through 4096-point analysers (half the reads, no gap). Not done: suspending
      the context when paused (`tick` detaches a context that is not running, a resume needs a gesture: too risky blind).
      Plainly: `on` in `liveSync.ts` is `process || coverPulse || viz || meter`, so `ends` alone never turns the live
      context on: the phone's listening-only context only exists with cover pulse, the visualizer or the meter on.
      To try on the phone, in order: (1) YouTube song, Bluetooth earphones, screen off, as before: no crackle = the second
      stream was it. (2) Still crackles: Settings › Sound, early song ends off (and cover pulse off), same test: no
      crackle now = the listening alone still hurts (look at the analysis next); still crackles = not the listening.
      (3) The YouTube Music app on the same earphones: crackles there too = Bluetooth alone. Not tried: `process` mode.
- [x] `M` The devices sync heard sooner on the network (the owner, 2026-11-18, from the phone: "que ça se détecte plus
      rapidement sur le réseau"). Today (`src-tauri/src/devices.rs`): listening starts 20 s after launch (`FIRST`), the
      automatic round runs every 60 s (`EVERY`) and wakes early only when a trusted device is heard for the first time
      (`heard`, the `fresh` check), not when its stamp changes; a device mDNS doesn't hear is tried at its last addresses
      every 10 minutes at most (`dv::PULL_EVERY`). Done = a change on one device reaches the other within seconds while
      both are open on the same Wi-Fi, without a flood of syncs; the wake rules tested in `crates/core` `devices.rs`.
      Done 2026-11-18: a change here wakes the round once settled (`dv::round_now`: 2 s quiet, 5 s between rounds at
      least, still every minute), the counter `Versions::changes` read every 2 s (no snapshot built for it); a trusted
      device heard with a new stamp or flag wakes it too (`Heard::wakes`). No wire or TXT change. Decided alone
      (2026-11-18): `FIRST` stays 20 s (the start is kept light), the 2/2/5 s figures are guesses. Tests: the rules and
      the counter (`cargo test -p music-core`), clippy; never tried between two real devices.
- [ ] `L` Android: the devices sync also runs while Legato is in the background (the owner, 2026-11-18: "même quand
      l'app mobile est en background et non ouverte en grand"). Today the multicast lock lives from `onCreate` to
      `onDestroy` (`MainActivity.kt`) and only playback keeps a foreground service (`PlaybackService.kt`, its Wi-Fi lock),
      so a phone in the background that plays nothing is likely frozen by Android (cached apps, Doze) and its round
      stops. Find what Android allows (a round as the app leaves the screen, a periodic job, the playback service's
      lifetime) without a permanent notification nobody asked for; tried on the emulator with the app in the background.
      Part done 2026-11-18, not tried: leaving the screen runs a round (`visibilitychange` → `devices_wake`), and the
      playback service, silent, now lingers 30 s off screen before it stops (`LINGER`, `MainActivity.leftAt`), so that
      round and the other device's answer finish before Android freezes the app; with music playing it already runs.
      Decided alone (2026-11-18): no WorkManager job or permanent notification (a sync long after leaving would need
      one); the media notification stays those 30 s as it did up to 60 s before. Not built or run here (no Android
      target nor `env.ps1` on this PC: the Kotlin is unchecked, CI builds it). To try on the phone: change a playlist,
      leave Legato at once (Home), within 30 s the PC has it; on the PC change one, the phone (off screen, silent)
      gets it only once back on screen. The page never sees `visibilitychange` on Android (`KeepVisible`): `onResume`
      and `onPause` call `window.legatoScreen` (syncmode.ts) instead, unchecked on a device.
- [x] `M` The devices sync needs no visit to the Sync screen (the owner, 2026-11-18: "qu'il ne faille pas aller exprès
      sur le truc sync, que ça se fasse automatiquement"). "Sync automatically" is on by default, but when both devices
      sync automatically only the smaller id starts (`dv::starts`), so a sleeping device (the phone in the background)
      can hold the other back; the Sync screen only refreshes the status (`Devices.tsx`, every 10 s) and "Sync now" is
      a button. Find why the owner had to go there, then fix it (for instance: the other side starts after a grace
      delay, a round as soon as the phone comes back to the screen).
      Done 2026-11-18, both: when both sync automatically, the bigger id starts too once a sync has been due here 30 s
      with nothing from the other (`dv::GRACE`, `starts`' new `waited`; a round woken then); the app back on screen
      (`visibilitychange`, `syncmode.ts`) calls `devices_wake`: a round now, and devices mDNS doesn't hear are tried at
      their last addresses at once (not 10 minutes later). Decided alone (2026-11-18): the likely cause is the phone as
      the smaller id, asleep or unheard after waking; 30 s is a guess; two syncs crossing at worst merge twice (no
      loss). No wire or TXT change. Tests: `starts` in `crates/core`; never tried between two real devices.

## The owner's asks of 2026-11-07, evening

- [ ] `S` Android: scanning a sync QR code crashes the app right after the camera permission is accepted (Beta
      1.1.785 on their phone; the diagnostics show three restarts in a minute and no error line: a native crash). 2026-11-07: the plugin's Kotlin (tauri-plugin-barcode-scanner
      2.5.3) shows no sure cause; a Java crash now lands in the diagnostics (`MainActivity.kt` `keepCrashes`, never built
      here: no Android toolchain on this PC), so the next Beta's Copy diagnostics names it. Faster: the phone on USB with
      debugging on, `adb logcat -b crash -d` on a PC with the SDK.

## The owner's answers of 2026-11-11 (still to build)
Also settled: no push yet (they try with `pnpm dev` first); the flowing background, the new-releases section and the
classic mini player stay off by default; the web share link stays the default; permissions ahead for the next runs: yes.

## The owner's asks of 2026-11-11, night

Noted from their message, nothing built or checked yet. After the answers above, or later, by the plan's priorities.
Where a line says "reading", the owner hasn't confirmed it.

- [ ] `M` Remixes shared outside the app: a small file of ours, `.lmix` (or close, the owner's call), and its compact
      link. It holds the song's YouTube link and the mix's Live Editor presets, never the audio (no mp3: Fixed
      limits, no download). Dropped on Legato, the song plays with the Live Editor open on those presets.
      A mix of a local file is the one case where the file carries audio (the owner's word, 2026-11-11): the mp3
      itself, or a version encoded for the `.lmix`. Only for the user's own local files, never a platform's audio
      (YouTube, Spotify, Apple Music: the link only). File only, too big for a compact link. To settle before
      building: a note at export that sharing a song is the user's responsibility (their own music or rights), a
      size limit, whether a personal server's song counts as local, and the embedded audio treated as untrusted
      when opened (the Security line).
      2026-11-11, the YouTube-link form: `.lmix` (JSON: format, version, name, video id, title, artist, the Live Editor's
      `Effects`) in `music_dsp::lmix` (64 KB, unknown fields refused, the settings clamped, tested with a fuzz loop);
      `lmix_read` / `lmix_write` in the shell; dropping one on the window plays the song and opens the editor on its settings
      (`features/editor/remixFile.ts`); Live Editor's menu has "Share this mix as a file…" (a YouTube song only). Left open:
      the Windows file type (double-click on a .lmix), the local-file form that carries audio (the owner's answers first).
      2026-11-12, the compact link: `legato://remix/<base64url of the settings that differ from neutral>` (about 280
      characters), copied from the Live Editor's menu ("Copy this mix's link"), pasted anywhere or opened from the system, checked
      like a file (`lmix::from_link`, fuzzed). Decided alone (2026-11-12): the link carries no audio and no new host. Untried: a real drop, the editor's load race on a slow start (waits 5 s), the YouTube thumbnail as art.
      2026-11-18 (lot 57), the file type: a `.lmix` double-clicked in Explorer opens in Legato (or the running one) like a
      dropped file (`protocol::file_of`: absolute, that extension, not a folder; then `openRemix` → `lmix_read`). Registered
      by the installer only (`src-tauri/tauri.windows.conf.json` `fileAssociations`; its uninstaller removes it), never by
      the app; dev, e2e and bench builds don't bundle. Decided alone (2026-11-18): class `Legato.Remix`, "Legato remix",
      the exe's own icon, role left at the default (macOS only); Windows only, else Android and Linux would claim it too; no
      `.legatosync`. If the installer breaks: delete `src-tauri/tauri.windows.conf.json`. Untried: a real install,
      double-click (app closed and open), uninstall. Still open: the local file that carries audio (the owner's call).
- [ ] `M` Optional sign-in with Discord, for a profile (the owner will make a Discord bot anyway). Never required.
      First use: the share page shows who shared a playlist, their profile carried in the link so it can't be faked
      (the owner's word: encrypted in the link). Open before building: encryption alone doesn't stop a fake, a
      signature does, and a signing key shipped in the app can be taken out of it; a signature by the owner's bot
      is a server of ours (CLAUDE.md: serverless). The owner's call between an unverified profile, or their bot
      signing as an exception to that rule. Discord's OAuth for a desktop app without a secret: to check; a new
      host, so a privacy row.
      2026-11-13, the version without a bot landed (Settings › General › Discord sign-in, off by default): OAuth code +
      PKCE, no secret, scope `identify`, redirect `http://127.0.0.1:47819/callback` (Discord matches it whole, so a
      fixed port), tokens in the keychain, the profile (name + id) in the library setting `discordProfile`; the link
      carries it as version 3 (`share::Profile`), the share page and the import dialog show "shared by …" as NOT
      verified. Decided alone (2026-11-13): unverified, since a signature needs the bot (still the owner's call).
      Untried for real: the Discord page, the redirect once registered in the portal, a busy port 47819.
      Left: the bot's signature, a song card's profile.
      2026-11-13 (lot 25): the profile counts only while the keychain still holds the sign-in (`discord_login::current`: links and Settings use it, a stale one is forgotten on the way; `standing` tested).
      2026-11-13 (lot 29): Settings › Accounts shows the account as a profile card (`DiscordAccount.tsx`: the banner, else the `accent_color`, the round avatar over it, the name, Sign out; no avatar: the initial). `users/@me` also gives `avatar`, `banner`, `accent_color`; `DiscordCard` (never in a link: `Profile` is unchanged, still unverified, no e-mail) keeps the two cdn.discordapp.com addresses, built in Rust from the id and a checked hash, shown through the `art` scheme (`art.rs`: only `/avatars/` and `/banners/` on that host). Settings › Privacy has a Discord reason (discord.com, discordapp.com), the website's privacy row says it. Untried for real: a signed-in account (animated avatars show their still PNG), the card in RTL and in the dark theme on screen.
- [ ] `L` Settings reorganised (the owner, 2026-11-13: "messy").
      - [ ] `M` The remaining JSX moved into one component per group (optional).
- [ ] `L` Right-click menus customised (the owner, 2026-11-13: "it fills the screen").
      - [x] `M` Every other menu wired (its items in `MENU_ITEMS`, `shaped(kind, …)`), then the customising screen (per kind: tick, reorder, Reset).
        Done 2026-11-18 (lot 59) for the long ones: the visualizer's menu is its own kind `visualizer` (11 items, none `detail`, so Standard shows what it always did) and a catalog result's menu (Add music) is the songs' (`track`, with `addToLibrary` added) so the preset and the customising screen reach both; Album and artist keep using the songs' menu. Decided alone (2026-11-18): the karaoke, cover, picture-in-picture, Live Editor, version, preset, add-on and plugin menus stay as built (3 to 7 items each, mostly the way out of their screen: a hidden "Leave" would be a trap), easiest to wire later with the same two lines. Tested by `menuItems.test.ts`; never seen in the app.
- [x] `S` Lot 51: the wrong artist picture came from a shared cache (the owner, 2026-11-15, "Strano": the photo of an Italian singer instead of the channel @StranoKHP). Cause, read in the code, not run-proven: `artist_picture` and `ytm_artist` read and write ONE cache keyed by the lower-cased name (`state.cache.artists`, 30 minutes), and `discord_artist_art` (the Rich Presence's small image) called `public_ytm().artist(&name, &[])` with NO titles, so it took the first same-named catalogue artist unchecked and `put` that page in the same cache; whoever filled the key first won, and the checked lookups then served the unchecked page, picture and top songs, without re-checking. Lot 36's wrong-artist rule (a page is kept only if its songs confirm it) had this hole: its own note says the Presence keeps the unchecked first result, and nobody saw it shared the cache. Done 2026-11-15: `Caches.presence_artists` (a second `Ttl`) holds the Presence's unchecked pages; `discord_artist_art` reads the shared cache first (a checked page is the better one) then its own, and writes ONLY its own; `artist_picture` and `ytm_artist` never read it. Pacing, the `LOOKS` limiter, the 6-hour miss and the refusal rules are untouched. Test: `an_unchecked_presence_page_is_invisible_to_the_checked_lookups` over the real `Caches` (several keys, empty, mixed case; a checked page may serve the presence, not the reverse); a separate cache makes a key function unnecessary (no shared key space). Audit: `grep` finds no other writer of `cache.artists` and no other `artist(` call with empty titles (`artist_picture` and `ytm_artist` go through `artist_page_for` with the song titles; lot 47's channel path comes from a song's own byline); `ytChannels` (lot 47) only holds channel ids read from a song's own byline, so by construction the song's. A poisoned page cannot survive a restart: `Ttl` is memory-only. NOT tried for real: the owner's real Discord presence together with Strano (the page is also only as right as the song titles sent for the check: a name whose real artist has no title in common with the library's songs still shows no page). References read: `src-tauri/src/lib.rs` (`Caches`, `discord_artist_art`, `artist_picture`), `ytm_browse.rs` (`ytm_artist`, `artist_page_for`), `crates/connectors/src/ytmusic/home.rs` (`artist`, `pick_verified`).
- [x] Lot 42, recommendation (the owner, 2026-11-14: Shuffle really shaped by the algorithm, no "Then, similar songs" switch, the best music for the user but a bounded dose of the new, many real mixes from a song they love). Design: `docs/recommendation.md` (read it first). Build in this order, one commit each, `pnpm check` green:
  - Decided alone (2026-11-14): the scoring stays in the front end (Up next and Shuffle live there) and moves to Rust only if slice 8 measures it slow; Variety is the one control (it was the user's only handle already); Shuffle is shaped whenever Smart shuffle is on (a "Smart shuffle" off keeps the plain random order, easiest undo: set `beta` to 0); explore dose 10 / 20 / 35 % with a floor above 0; every number is a first guess, never heard by ear.
  - Lot 65 (2026-11-18), slice 3 done: `TasteSignal.replays` and the pair-skip drop in `near` come from the same SQL pass over `plays` (`crates/core/src/history.rs`); a replay counts as a like in `taste.ts`. Decided alone: 1 replay is enough (within 24 h, last 30 days); a pair is dropped at 2 skips in 90 days; this session's replays only count after the next signals reload (every 20 listens). `cargo test -p music-core history` and clippy on that crate pass. Never felt. Slices 4 and 5 are open.
  - Lot 64 B (2026-11-18), slice 2 "Why this song" done: each pick at the end of Up next and in a mix from a song carries the ONE reason that scored it most (`pickWhy.ts`: "In 3 radios of what you played", "You often play it next to songs like these", "By an artist you play next to these songs", "Sounds like what is playing", "Something new for you"), shown after the artist in Up next like the Auto-DJ's. Decided alone: no "Played after <artist>" (the fit does not keep which queue song a link came from, naming one would be made up); easiest undo: remove the span in `UpNext.tsx`. Slices 3 to 5 are open. Never seen in the app; texts in 19 locales, machine translations (the French says vous).
  - Lot 64 A (2026-11-18): an early skip of the app's own picks steers the rest outside Shuffle too (`markPicks`, tested in `feel.test.ts`; docs/recommendation.md › In the session). Decided alone: Auto-DJ picks count as picks too; picks are remembered by id and forgotten when a new queue plays, a restored session loses them (no steering, never a wrong move). Never felt in the app.
  - Slice 1 of `docs/recommendation.md` › Slices done 2026-11-18 (lot 62): Up next's end takes the radios of the last 3 distinct YouTube songs and "Start a mix" the seed's, signed in or out, merged with `votes` (`crowd.ts`), fit's radio term x (1 + 0.5 x (votes - 1)). Slices 4 and 5 are open (2 and 3 are done below). Untried against the real YouTube Music; the public radios' answers signed out are as the Mixes page already gets them.
  - Ticked 2026-11-18 (lot 55): the parent was left open by the clean-up while its slices shipped (git log: `dacf3cd6` taste signals, `a137385c` the score, `01475207` Shuffle, `ca2f6720` the switch gone, `74501e5d` the end of Up next, `66b542e8` Variety and the bench, `4a921e9f` the rebuild). Every number is still a first guess never heard by ear: that stays the owner's test, not a line.
  - [x] Rebuilt 2026-11-18 (the owner, 2026-11-17: Shuffle in playlists and mixes "horrible", redo it like YouTube or TikTok): `docs/recommendation.md` › top (what made it bad, each fault reproduced in `feel.test.ts`), Shuffle, In the session. Decided alone (2026-11-18): Shuffle weighs rest x marks (no play count, no artist taste), keeps each artist apart, and an early skip steers it at once; the picks multiply fit by preference (a high rating lifts a song among those that fit, no longer over them); songs heard one after the other on this PC count in the fit (`TasteSignal::near`). Easiest undo: revert the commit. Never heard by ear.
- [x] `S` Add to playlist offers the imported playlists (the owner, 2026-11-17: on the phone an imported one was never offered). Cause: the menu offered your own, the YouTube Music ones only while signed in (written on YouTube) and a Subsonic server's (`takesEdits`); signed out, as on the phone, no imported one, on the desktop too. Done 2026-11-18, the owner's word ("as if the playlist came from this device", a copy tried first and dropped): the song goes into the imported playlist itself (`Library::add_here`, table `playlist_added`, schema v23), plays by its YouTube version like the rest, stays through the service's next imports (at the newest end) and travels with Sync Mode (`PlaylistSnap.added`); only those songs come out (Remove from ›, a click on its checked row in Add to playlist), the service's own stay its, never reordered; YouTube's own likes stay out (the heart's). Untried on the phone.
- [x] `S` Now Playing's "From …" kept through a relaunch (the owner, 2026-11-17: lost each time). Cause: `resume` cleared it. Done 2026-11-18: saved with the queue (`session.ts`, the same setting on the desktop and the phone) and given back to `resume`; a resume that names none (a room, a blind test, a pick-up) still leaves no old one. A radio or a mix comes back with its label but, as before, no longer grows. Untried in the app.
- [x] `S` The phone: the YouTube video's box at the foot of Your library (the owner, 2026-11-17: far too much room). Cause: the mini player docked in the sidebar (place "In the sidebar", a desktop-only setting a phone can still hold) kept its 200 px video slot there. Done 2026-11-18: on the phone no card at all (the owner, 2026-11-18, after a slim row whose time line doubled the bar's: "nothing at all"), the video out of sight as for the floating card since 2026-11-06, Now Playing showing it. Untried on the phone. Lot 62, 2026-11-18 (the owner, with a screenshot: the card repeats the bottom bar): the 'sidebar' place is gone for everyone: `miniPlace` is `panel` | `float`, a stored 'sidebar' reads as `panel` (`theme.test.ts`), `SidebarPlayer.tsx`, its mount, its two locale texts and the choice in Settings are removed; the phone's hidden video slot comes from `MiniPlayer` (narrow = floating path). Untried in the app.
- [ ] `M` Android home-screen widgets (the owner, 2026-11-13, like YouTube Music's): three, from `MediaState` only (no network, the page's cover, no secret), buttons = the notification's actions through `PlaybackService`; `Widgets.kt`, res `widget_*`.

- [ ] `M` Discord bot (the owner, 2026-11-13: to make later, for social features; optional, an exception to serverless that the owner validates; the application « Legato Manager » already exists, public client + loopback redirect set)
- [ ] `L` The website made beautiful (the owner: too basic today) and given documentation sections for developers
      (plugins' API, themes, the link and file formats, contributing). The design is a piece Fable may do itself (the
      owner's word).
      2026-11-13 (lot 32), looked at before touching anything: the hero at 1440 px (dark) and 375 px (light), through the built-in browser on `next dev`. It is already a product page (the headline as the picture, the real interface tilted in 3D from the demo, one download button, the privacy link, the platforms line) and holds at phone width in the light theme; no redesign was made, because a taste change nobody could judge here would only risk what works. The plan's "too basic" predates the Story and the demo. Left for the owner's eyes: the chapters below the hero, the Features block, the 18 languages' longest lines.

## The owner's asks of 2026-11-13

- [ ] `S` Remove the rename catch-up (when every PC of the owner runs the new name): delete `src-tauri/src/rename.rs` and its call in
      `lib.rs`, the old Run entry handling in `autostart.rs` (`OLD_NAME`, `music-app.exe`), the old-install cleanup in
      `src-tauri/windows/hooks.nsh`, the old identifier in `identity.rs` (guest list), `e2e/e2e.test.ts` and `scripts/bench.test.ts`, the
      `Music App Sync` note in `CLAUDE.md` › Names; the `music-app-sync` sync label stays (see above).

## The owner's asks of 2026-11-12


## Best in class (user's ask 2026-10-30)

What a listener would get, against Riff (rootscripts/riff: Electron, yt-dlp downloads, YouTube / SoundCloud, imports
from Spotify / Apple / Deezer) and the best players overall (Spotify, Apple Music, MusicBee, Plexamp, foobar2000,
Cider). Already ours and kept as selling points: legal playback (no downloads), Tauri (light), Sync Mode between PCs,
Last.fm, Music Detector, Live Editor (10-band EQ, tempo, pitch, reverb, space), smart playlists, stats, mixes, sleep
timer, synced lyrics with offset, visualizer, themes + own CSS, plugins, Windows media panel, global shortcuts, many
languages. Rules unchanged: nothing on this list downloads, records or exports a platform's audio, and no server of ours.

Each line below is detailed (what the user sees, how, rules, effort, done when) in [ideas/](ideas/README.md).

### Roadmap (order to build in; effort S = one session, M = a few, L = many)

Pick from the top. Each milestone is one release on the Stable channel; workflow items that unblock others go first, and
a quick win from Features › High can go in any release. Milestones 0 (Groundwork), 1 (First impression) and 2 (Sound and
sight) shipped together as Stable 1.1.

| # | Milestone | What lands | Effort | Why now |
|---|---|---|---|---|
| 3 | Platforms (1.2) | Spotify private playlists and Liked Songs for free (Connect Spotify, guided copy, data export), SoundCloud links, playlists as files, import from other apps | M | The user's ask; a library that can't move is the first reason not to switch |
| 4 | Lyrics (1.3) | Word-by-word lyrics, translation, find by a line, lyrics saved into files and tapped live | M | Riff and Cider's most loved screen |
| 5 | Your own music (1.4) | ~~Jellyfin / Navidrome / Subsonic / Plex~~ (done 2026-11-06), ReplayGain, batch tag editor + MusicBrainz, ratings, column view, ListenBrainz, playlist folders | L | MusicBee / foobar / Plexamp users switch for this |
| 6 | Smart (1.5) | Local sonic analysis, song / artist radio, sweet fades, path between artists, auto-DJ, smart shuffle, Wrapped | L | What no free desktop app does without a server |
| 7 | Around the house (1.6) | ~~Phone remote~~ (done 2026-11-02), cast (DLNA / Chromecast), ~~listen together on the LAN~~ (done 2026-11-06), pick up on the other PC | L | Turns a player into a home system |
| 8 | Windows polish (1.7) | Command palette, taskbar buttons + Jump List, headphones / call pause, alarm, OBS overlay, PiP, drag from Explorer | M | Small, many, each a reason to stay |
| 9 | Everywhere (2.0) | The mobile version (Android, then iPhone: the owner's ask 2026-11-02, [ideas/mobile.md](ideas/mobile.md)), macOS and Linux builds | L | Riff's one platform lead; the owner wants Legato on the phone |

Kept apart (need the user's call or an outside step): Spotify playback paths, Spotify's web session, LLM playlists with a
user key, SoundCloud playback and search (its terms), concerts (an API's terms), trademark search.

### Against Liner (user's ask 2026-11-05: lead it on every point)

Liner (`tryliner/desktop`): Electron, Windows / macOS / Linux, an account on its server, YouTube's audio taken and
served from its own copies (never ours: CLAUDE.md). The comparison, row by row, and each line's detail:
[ideas/liner.md](ideas/liner.md). Already ahead: weight, no account or limits, privacy, the phone, languages in the app,
the visualizer, the library, the player's tools, updates. Already ours too (checked 2026-11-05): the instrumental mark,
the settings search in every language, an everywhere shortcut for picture in picture, brand channels, recent searches,
Discord's buttons, the taskbar's thumbnail buttons, issue forms.

Numbered easiest first (the owner's ask 2026-11-05: all of them, by difficulty). Built hardest first: the owner's
ask for the autonomous run of 2026-11-05 evening,
with the interface on top (U1, U2 below): ours does too much on a phone, and lacks the glow and the simplicity Liner
has (inspiration only, never its code or assets). Never copied: their playback (YouTube's audio taken, their own
copies, downloads for offline), their accounts, limits and paid plan.
      2026-11-12: while Your stations is empty the page shows "Stations to start with": the most listened of the user's country
      (`region()`: the interface's language, never an IP lookup) and of the two genres their local files' tags and listens weigh
      most (`suggest.ts`), at most three requests (`radio_suggest`); the website's row says exactly what goes (a country code, up
      to two genre words). The heart keeps one. Decided alone (2026-11-12): asked when the page opens (not on a button), once per
      visit, since the page is the radio; the region is the interface language's (Windows' own region isn't read). Never seen.
- [ ] 6. `S` A native window on Windows 11: snap layouts on our maximize button (`WM_NCHITTEST` → `HTMAXBUTTON`,
      beside `thumbbar.rs`), Windows' minimize and maximize animations.
      The owner's choice 2026-11-11: together, with the owner at the PC (not built blind).
      Left by the autonomous run (2026-11-11): WebView2's own child windows cover the title bar, so the hit test has
      to be answered there and the button's hover and click redone by hand; a mistake breaks the window's buttons for
      everyone, and it can't be tried without a screen. With the owner at the PC.
- [ ] 15. `M` SoundCloud sets and likes: set aside (the owner's word, 2026-11-07). Its API terms (§01, §03, §10.4)
      forbid rebuilding its sets on YouTube without a registered app of theirs. Today's way, untried: Tune My Music's
      CSV export through Add music › song list.
- [ ] 16. `M` Reach: left, microsoft/winget-pkgs#474341 merged by Microsoft's moderators (submitted 2026-11-07; then
      a manifest per Stable, `packaging/README.md`). Done: the website in 18 languages, README screens, Discussions;
      no Scoop (decided alone).
- [ ] 17. `L` Listening rooms over the internet, no server of ours: sealed control messages through a public relay (the
      owner's call), or the LAN. Takes in "Listen together on the local network".
      - [ ] The internet half (the owner's choice 2026-11-07): WebRTC data channels, offers sealed with the room code
        and swapped once through public Nostr relays (relay.damus.io, nos.lol), Cloudflare's STUN for each side's public
        address; no TURN, so two strict NATs can't meet. The relays see the room's random id, both public IPs and the
        times, never songs, names or reactions: a privacy row says so.
- [ ] 18. `L` A Linux build (AppImage, deb): WebKitGTK, the MPRIS media panel, the tray, PipeWire for the detector.
      Built by GitHub's Actions (the owner's word, 2026-11-07); local tries in WSL or a VM once the owner sets one up
      (a system change, theirs). 19 the same, on a macOS runner.
- [ ] 19. `L` A macOS build, unsigned first as Liner's (signing: the owner's Apple Developer Program): WKWebView, Now
      Playing, the menu bar. 18 and 19 take in Features › High's macOS and Linux line.

### Platforms (milestone 3, user's ask 2026-10-31)

What the services allow, read on 2026-10-31 (specs in [ideas/catch-up.md](ideas/catch-up.md)):

- **Spotify, official API:** reads a user's own playlists, but a Development Mode app needs a Premium owner, so never free
  ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)).
- **Spotify, web session:** the token needs the TOTP hidden in the web player's code. Rebuilding it defeats a technical
  protection: never. Reading what the signed-in player shows needs neither that token nor that secret (each row has its
  title, artists, album, duration and track link: checked on a public playlist, signed out, 25 rows drawn of 50, so it
  scrolls). But Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) ban scraping, by hand or
  automated, and a breach can close the account (no such ban found in a search). The user took that risk on 2026-10-31,
  and the app says it before the first connection.
- **SoundCloud:** its [API terms](https://developers.soundcloud.com/docs/api/terms-of-use) bar scraping, require a
  registered app, and bar a playback experience that mixes its content with other services'. Its site terms restrict
  players used to build a streaming service (read as a summary only: the full page didn't load). So links imported
  as metadata first; playback and search are the user's call.

- [ ] `S` Connect Spotify, not tried yet: playlists inside a library folder, a collapsed library column, an expired
      session, the window covering Legato while it reads (Cancel in the toast may be behind it), a list with local files.
- [ ] `M` Likes and adds sent to Spotify (Send only, Both ways): official API only, so a key and a Premium account, also
      to test it. No way without them: Exportify only reads, and pressing hearts in Spotify's page would be a bot on the account.
- [ ] `S` per service: public playlist links from more services (TIDAL, Qobuz, Amazon Music), same flow as Deezer. Nothing
      checked yet.
- [ ] `L` SoundCloud playback in its official embedded widget (no audio taken). User's call first: see its terms above.
- [ ] `M` SoundCloud search beside YouTube's (widget playback, its terms checked first). The only keyless way is the
      site's own client id, which its API terms rule out: not advised.

### Features, sorted (user's ask 2026-10-31)

Three groups, easiest first inside each. The tag is the effort from the specs (a guess where there's no spec yet).
Importance is a first estimate (2026-10-31), the user moves lines as they like.

- **High**: most listeners would notice it, or it removes a reason not to switch.
- **Medium**: a real gain for one kind of listener.
- **Low**: niche or fun, for later.

**High**
- [ ] `L+` Mobile version, well optimised, the Rust code reused (the owner's ask 2026-11-02): Tauri 2's Android target
      with the same crates and `ui/`, Android first, iPhone after. Spec, seven phases, what stays desktop-only and the
      owner's calls (Android SDK / NDK on this PC, a phone, GitHub or Play Store, YouTube sign-in in a WebView):
      [ideas/mobile.md](ideas/mobile.md). Phase 1, the phone layout in `ui/`, done 2026-11-02; phase 2 needs the owner's
      Android tools.
      The owner's ask of 2026-11-02: the mobile app working completely, synced with the PCs over Wi-Fi both ways, then
      a Beta with the APK; Android first; YouTube signed out on the phone, the library from the PC by sync.
  - [ ] iPhone: not for now (the owner's word, 2026-11-07); later, their signing choice (Apple Developer Program, or an
        unsigned .ipa).

**Medium**
- [ ] `S` Community: GitHub Discussions (on since 2026-11-07, with the "good first issue" label) linked from About, a
      showcase of themes on the website.
      2026-11-11: Settings > About > Community opens the Discussions. Left: the website's showcase of themes (it
      needs themes to show: the owner's or the first shared ones).
- [ ] `S-M` Watch-page player: hide YouTube's own playlist panel (its RDMM "My Mix") and stop its autoplay into a Mix
      (`crates/shield/src/watch.js`).
      Left by the autopilot (2026-11-05): `watch.js` already hides the column the panel sits in (`#secondary`, `#below`)
      and pauses at the end; what's left needs a real watch page, behind YouTube's cookie choice in a new profile.
- [ ] `M` Lyrics translation in the panel (a service sends text: add the website's privacy row first).
      Owner's call (2026-11-01): which service gets the lyrics (the user's own DeepL or Google key, a LibreTranslate
      server); Windows gives apps no offline translator. The panel side is small once that's chosen.
      2026-11-13: built on MyMemory (`connectors/translate.rs`, no key, 500 bytes a request, ~5 000 characters a day per address
      without an email), behind Settings › Playback › Translate lyrics (off by default): a "Translate…" button on the lyrics'
      source line, a box that says what goes where, and the words leave only after "Send and translate"; the result shows
      each line over its translation in the box, never kept. The site's Lyrics privacy row says it. Decided alone
      (2026-11-13): MyMemory, because it is the one free service with no key and no account of ours; its daily quota fits a
      few songs a day, so a user's own DeepL key or a LibreTranslate server stays a possible later swap (one file). Tested with
      mockito only (chunks, quota, refusal, shape), never against the real service. Left: the translation under the lines
      inside the panel itself (it shows in the box), a language other than the interface's.
      2026-11-18 (lot 61): the translation the user asked for now shows under each sung line in the lyrics panel (a smaller row, in the interface's language, this song only, kept in memory by `translated.ts`; the lines are matched by `alignTranslation`, tested: breaks, empty lines, a short or long answer, a repeated chorus). Nothing new is sent (the same box and "Send and translate"). Left: Karaoke (its fixed seats would need a layout of their own), a language other than the interface's. Decided alone (2026-11-18): no new setting (it appears only after the user's own Translate…), a line the service returns unchanged gets no row. Not tried in the app: the glide after the rows change line heights (the effect re-measures when the translation arrives, from the lot 52 recipe).
- [ ] `M` Equalizer presets per output device (headphones vs speakers) and AutoEQ profiles for known headphones.
      Skipped 2026-11-12 (not for this run): the engine only knows the default output device (`output.rs`), no name and no change event,
      so per-device presets need platform code (a device-change watch on WASAPI, then the same on the other systems); AutoEQ profiles
      are parametric filters from a large dataset to map onto the 10-band graphic EQ, a data and licence choice. For Opus and the owner.
- [x] `M` Credits and artist pages: who wrote / produced (MusicBrainz), a short bio (Wikipedia), links out.
      Ticked 2026-11-18 (audit): everything the line names shipped: the links (`MusicBrainz::artist_links`), Credits (`eae99997`), the bio (`afb764fd`), YouTube Music's About (`71d4c9bb`). What is left is a try against the real services (Check live).
      2026-11-12, the links out only: an artist's page has "Find links on MusicBrainz" (a click, two requests a second apart, the
      name only; `MusicBrainz::artist_links`: the artist by exact name with a score of 90, then its url relations, http(s) of 8
      kinds, 12 at most), opened in the browser; the website's "Artist links" privacy row. Untried against the real MusicBrainz: the answers' shape is from their docs. 2026-11-12, who wrote / produced: a song's
      "Credits…" (any song: library or not) opens a dialog that asks MusicBrainz as it opens (the recording by title, artist and length,
      then its relations: two requests; producer, composer, lyricist, writer, arranger, mix, engineer, mastering, conductor,
      voices and instruments, 40 at most, grouped by role); the website's "Song credits" row. Decided alone (2026-11-12): opening the
      dialog is the click, so no request leaves before it.
      2026-11-12, the bio: once the links are shown and one is a Wikipedia page, "Short bio" (a click) asks that page for its
      opening paragraph (`wikipedia.rs`, one new host family: the article's own `xx.wikipedia.org`, address checked first), shown with
      "From Wikipedia, under CC BY-SA" linking to the article; the website's "Artist links" row says so. Untried against the real
      Wikipedia (mock tests only). Decided alone (2026-11-12): on a click, never on opening the page.
- [x] `M` Sweet fades (Plexamp): crossfade length picked per pair from the songs' ends (loudness, silence, tempo).
      Ticked 2026-11-18 (audit): tempo (`9f1a1fed`), the ends' loudness and silence (`7b87b623`), the next song really coming (`ef27f850`) shipped; only hearing it on real songs is left (the owner's ear).
      2026-11-13, by tempo: Settings › Playback › Sweet fades (off by default): `sweet.ts` `sweetSeconds(a, b, base)` picks each
      pair's fade out and fade in from the library's `bpm` (whole phrases of 8 beats when the tempos are within 4%, half and
      double time counted; the set seconds within 12%; at most 3 s beyond; unknown tempo or no fade: unchanged), `songFade`
      and the fade in of a song that starts on its own use it. Tested as a pure function only. Left: silence and loudness at
      the ends (the player knows them only after a song has played; they need the local analysis to store them per song).
      Decided alone (2026-11-13): tempo first, because it is the one signal the library already holds per song.
      2026-11-13 (lot 27), the ends: for local songs the earlier measures (`song_ends`, cached silences and loudness only, nothing
      decoded) join the tempo: a loudness gap over 6 dB stretches the fade up to half again, a song ending in 3 s of silence
      or more gets a 2 s fade out (`sweet.ts` `sweetFade`, fed by `sweetData.ts` / `sweetLoad.ts`). Tested on made-up numbers;
      the songs not yet measured (never played) use the tempo only. Decided alone: the silence rule shortens rather than
      lengthens, because the song already fades itself out there.
      2026-11-13, not started (decided alone): the fade is applied in three places (`songFade`, `playAt`'s `fadeIn`, the
      engine's own crossfade for files), and a per-pair length wants to be heard on real songs, not built blind at night.
      (Left by the autopilot (2026-11-05): a song's end is only known measured (local files, Skip silence on) or
      heard once (a video, `ends.ts`), its tempo not at all; the overlap is the player's most fixed code, and a
      length picked per pair needs an ear to tune: with the roadmap's Sonic analysis, or with the owner listening.)
- [ ] `M` Long YouTube mixes and DJ sets split by their chapters (or timestamps in the description / pinned comment):
      each part a song in Up next, skip within the video; Music Detector names unlabelled parts on request.
      2026-11-13, the chapters: Settings › Playback › Chapters of long YouTube videos (off by default; a video of 15 minutes or
      more that plays asks YouTube's own `next` call, `ytweb::chapters`: its chapter markers, else the timestamps of its
      description, `core/chapters::from_text`) fills the same Chapters menu the audiobooks use. Tested on made-up answers and
      descriptions only (mockito), never on a real video. Left: each part as its own row in Up next, the pinned comment (a
      separate continuation call), Music Detector naming unlabelled parts.
      2026-11-18 (lot 56), each part as its own row of Up next: done (`videoParts.ts`, `splitIntoParts` / `followPart` in
      `store.ts`, tested on made-up chapters). Decided alone (2026-11-18):
      - A part is a queue row over the same video (`part: { startMs, endMs }`, a row of its own outside the library like a
        recommendation, `remoteTrack` keyed by its start); times stay the video's everywhere, so the progress bar shows the
        whole video and a seek there stays in it. Why: the fades, the overlap, Skip silence, SponsorBlock and the resume
        all read the video's time; a time per part would touch each of them.
      - The music reaching the next part only moves the row along (index, title, a new playId): no seek, no fade, the set
        plays on as one. Next / Previous / a part picked in Up next seek the same embed (`playAt`, its start). Why: a DJ
        set is continuous; a seek at each part would cut it.
      - A part's end is as exact as YouTube's time reports (the watch page's once a second, the embed's about as often):
        it only matters when what follows is not the next part (taken out of Up next, Repeat one, another song), where up
        to about a second of the next part can be heard. The IFrame API's `endSeconds` stops the video, which would cut
        the gliding parts. A part followed by another song ends with a cut, not a crossfade (the overlap times the video).
      - Shuffle and an early skip's steering keep a video's parts together and in order (`keepParts`); taken-out parts stay
        out. Only the playing video is split, once its answer comes (the setting on, 2 chapters or more).
      - Plays and ratings: the parts count none; the video counts once, its listen running from its start until a part is
        picked by hand (the parts gliding on do not end it), so a whole set heard is one full play, not 30. Edits saved
        for the library video do not apply while it plays split (its parts key by the video, `songKey`).
      Not tried: a real long mix, a real Google answer (the owner: turn the setting on, play a DJ set with chapters, let a
      part end, press Next / Previous, take a part out of Up next, shuffle, quit and reopen the app mid-set).
- [x] `M` Output devices: switch from the player bar, remember per device (volume, EQ preset).
      Ticked 2026-11-18 (audit): the switch, volume per device (`ca26c14c`) and EQ per device (`8fc31212`, `a5618b3d`) shipped; a device-change event is left (WASAPI watch: needs a real device).
      2026-11-13 (lot 27), EQ per device: Settings › Playback › Equalizer per output device (off by default) adds "Equalizer for this
      output" to the player's menu: one of the built-in presets per output device (this PC's, `deviceEq.ts`), whose bands are
      added to the song's own Live Editor edit (`withDeviceEq`, tested) on the one path that already pushes effects to the
      engine and to YouTube's player (`liveSync.ts`). Not heard on a real headset; the device change itself is only seen when
      picked in the player's menu.
      2026-11-13, the switch: the player's menu has Output device (shown with two devices or more; System default, then the system's list,
      the picked one checked), `Command::SetDevice` moves what plays like the unplug `Reopen` does (same place, paused or not), the pick
      is kept on this PC (`outputDevice`, applied at launch; a device gone falls back to the default). No setting: the entry only
      appears when there is a choice. Never tried with real devices. 2026-11-13, volume per device landed (Settings › Playback › Volume per output device,
      off by default; `volumePerDevice.ts`, the volume set on a device picked here comes back when it is picked again, this PC's, 50 devices; Windows' own
      default changing is not seen). Left: EQ preset per device (skipped for now), a change event (the list is asked when the menu opens).
- [ ] `M` Right-to-left languages (Arabic, Hebrew: mirrored layout) and community translations (Weblate), more languages.
      2026-11-13 (lot 27): the layout mirrors with `dir`: the shell and every shared component outside the player use logical
      sides (ms- me- ps- pe- start- end- text-start rounded-s border-s; `i18n/rtl.test.ts` fails on a physical one), the
      page's `dir` follows the language (`isRtl`: ar, he), arrows and carets turn (`shared/ui/directional.tsx`, Phosphor's
      `mirrored`), and the player bar and the player's pages (`features/player`, `features/viz`) keep their sides on purpose
      (media controls, visualizers, the time axis do not mirror). Arabic and Hebrew are in the picker (`locales/ar.ts`,
      `he.ts`, all 2 516 texts, plural forms limited to the one / other pair the code asks for): MACHINE TRANSLATIONS, written
      by the model that built the app, to be reviewed by native speakers, which Weblate would make possible (not set up).
      Not seen on a screen: the mirrored layout (a physical offset in a style attribute, a canvas, or an absolute position
      in the player's pages may still sit on the wrong side), nor the Arabic and Hebrew text in the interface. The website
      stays in its 18 languages.
- [ ] `L` Cast: DLNA / UPnP speakers and Chromecast for local files and personal servers.
      2026-11-13, DLNA / UPnP for local files: Settings › Playback › Cast to speakers (off by default) adds "Cast to speakers…" to
      the player's menu: a box lists the renderers that answer an SSDP search (`connectors/dlna.rs`), one click plays the song
      on one (SetAVTransportURI, Play, then Pause / Play / Stop and a seek by SOAP) and pauses it here. The renderer pulls the
      file from a one-file server this PC starts on its private address (`src-tauri/src/cast.rs`: random token in the path,
      GET and HEAD with ranges, private peers only, one cast at a time, stopped by Stop casting). Every description or control
      address that is not a private one is refused. Tested on made-up answers, a fake renderer (mockito) and the file server
      over loopback; never with a real speaker or TV (their quirks are the unknown: protocolInfo, DIDL, seek support).
      Left: Chromecast (its own protocol), songs of personal servers and the queue (one song at a time), a volume control,
      the renderer's position (the box does not follow it), the PC's firewall prompt on first use (Windows asks).
- [ ] `L` Sonic analysis, ours and local: features (tempo, key, energy, brightness, mood) computed from local files, and
      from what plays live for streams (the meter already listens; measured, not extracted), stored per song. Feeds
      "similar songs", song radio, sweet fades, the path between artists (Plexamp's Sonic Analysis needs a server).
      Skipped 2026-11-13 (night), the tempo-only slice: a tempo found by decoding every local file (onset autocorrelation) is minutes of CPU on a
      big library and its right answer (octave errors, half and double time) can only be judged by ear against known songs; the tags'
      BPM already feed Mixes and the metronome. Better with the owner's ear on a test set.
      2026-11-13, the tempo-only slice landed anyway (the owner's wider mandate), behind Settings › Playback › Estimate tempo (off by
      default): `music_player::tempo` (onset curve of the first 90 s at 200 a second, autocorrelation 60-180 BPM, a pull toward
      120 against double and half readings, no answer for silence, noise or a clip under 12 s; click tracks 75-170 BPM read within
      2), a few files at a time off the UI thread (`src-tauri/src/tempo.rs`, 5 at most per call, one call every 15 s while songs
      wait, then every half hour, first one 2 minutes after launch), answers kept by file and modified time in the library
      setting `tempoGuesses` (no schema change), filling only EMPTY tempo, never over a tag. Decided alone (2026-11-13): tempo
      only, estimates share the BPM column with tags (no marker), octave errors accepted until an ear checks real songs. Never
      heard on real songs; energy, key, mood and the similarity feeds are left. 2026-11-13 (lot 25): the answers are kept in memory and written back every 10 calls and at the end of a run, no longer whole on every call.
      2026-11-13 (lot 26), the key: `music_player::key` (pitch-class energy by Goertzel from C2 to B6 on 30 s brought down to 11 kHz,
      Krumhansl-Kessler major and minor profiles in 12 rotations, no answer for noise, silence, a clip under 8 s or a close tie;
      triad progressions in C and in Am read right, noise and silence read none) fills an EMPTY key (written "C", "Am", "F#m" as
      tags do) in the same scan, same setting (its text now says "tempo or key"); the kept answers carry the key too (older
      ones still read, and are decoded once more). Real music is the unknown: the thresholds (0.55 match, 0.03 margin, 0.15
      spread) were set on made-up chords. Left: energy, brightness, mood, and the similarity feeds.

**Low**
- [ ] `M` Concerts near the user from followed artists (a public API with no account; privacy row).
- [ ] `M` Audiobooks from local files (m4b chapters, resume per book, speed, sleep at chapter end), apart from music.
      2026-11-12, one half, resume per book (the line stays open): a song of 20 minutes or more, a file of this PC or of a personal
      server, is picked up where it was left: its place is kept every 10 s and when paused (this PC's storage, not synced), the
      song starts there when played again, and a notice says so with "Start over" (`resumeLong.ts`, `resumePoints.ts`); near
      either end the place is dropped, 200 songs at most. Left: m4b chapters (a container parser in Rust), a speed kept per
      book (the Live Editor has speed), the books apart from music (a page). Decided alone (2026-11-12): local and server
      files only (a YouTube video has no stable place), 20 minutes as the line. Never tried on a screen or by ear.
      2026-11-13, m4b chapters and sleep at chapter end: a library `.m4b` / `.m4a` / `.mp4` with a Nero `chpl` chapter list (what ffmpeg
      and mp4v2 write) gets a "Chapters" submenu in the player's menu (go to one, the playing one checked) and "End of this
      chapter" in the sleep timer (`core/chapters.rs` reads the `moov` box only; `track_chapters`; `player/chapters.ts`). Not
      read: QuickTime text-track chapters (Audible and iTunes books may use them) and ID3 `CHAP` of mp3s: those show none.
      Never tried on a real book. Left open: speed kept per book (the Live Editor saves its speed per song already, when
      switched on), the books apart from music (a page).
      2026-11-13, the books apart from music: Settings › General › Audiobooks (off) adds Audiobooks to the app menu: a page of the library's long
      files (tagged audiobook / spoken word at 10 minutes and more, or two hours and more; this PC's or a server's), longest first, with where each
      was left and the time left (`books/books.ts`, the resume points of `resumeLong.ts`). Decided alone (2026-11-13): the books are still in
      Songs too (hiding them there would change a list people know). Never seen on a screen.
      2026-11-13, a speed per book: 1, 1.25, 1.5, 2 on each book of the page (this PC, `books/speed.ts`); the book starts at it through the
      Live Editor's tempo (pitch kept) unless the song has an edit or a draft of its own (`editor.ts` `bookEffects`); the one playing moves at once.
      2026-11-13, the other chapter forms: QuickTime chapter tracks (the text track a `tref/chap` points to, read from its sample
      table: Apple's and Audible's books) when a file has no `chpl`, and the `CHAP` frames of an mp3's ID3v2.3 / v2.4 tag (title
      from `TIT2`, any text encoding); `.mp3` now asks too. No new dependency (`core/chapters.rs`). Tested on files built in the
      tests only, never on a real book of either kind; a QuickTime track with an unusual layout (chapters in the audio file's own
      sample description, text in UTF-16 without a mark) shows none.
- [ ] `M` Stream Deck plugin and an Xbox Game Bar widget (play / skip / like / now playing) over the local hotkeys.
  2026-11-13: Stream Deck done as `integrations/streamdeck` (`docs/streamdeck.md`): play / pause, next, previous, now
  playing, over the phone remote's local routes; logic tested, never loaded by a real Stream Deck. Left: its like key (the
  remote has no like route), the Xbox Game Bar widget (a UWP package, nothing here could build or load it).
- [ ] `M` Theme and plugin gallery without a server: an index file in a GitHub repo, browsed from Add-ons, installed after
      2026-11-13 (wider mandate), still not built: the index has to live in a repository that does not exist yet (and the project never creates
      one on its own); a gallery that can list nothing would be a fake button. When the owner makes it: one `index.json` (name, kind, url, sha256, size), fetched through `Noted`, a download refused when its hash differs, themes through the existing theme import, plugins through `plugin_inspect` and its permission review.
      the usual permission review; authors submit by pull request.
      Skipped 2026-11-13 (night): installing means downloading code or theme files from a repository into the plugins folder, then the
      permission review: the download, its size and hash checks and the trust in the index are the owner's to set (who may publish, pinned
      commits); a first slice (read the index, list it) alone would show entries nobody can install.
- [ ] `M` Sharing: remote wormhole words (needs the user's OK on the public relay), webcam QR scanning, `musicapp://` links
  2026-11-13: webcam QR scanning done behind Settings › Playback › Scan QR codes with the webcam (off, this PC's own): a
  Scan with the webcam button in Add a device and Listening rooms; jsQR (Apache-2.0) loads at the first scan, the camera is
  asked for at the press and let go of when the window closes, no picture is kept or sent. Decoding is tested on a real QR
  matrix; not tried: WebView2's camera permission prompt and a real webcam. Left: the share import's QR (it reads an
  image file today), wormhole words, `musicapp://` (renamed away).
      clicked in a browser (deep-link registration).
- [ ] `M-L` Practice mode for musicians: A-B loop, slow down without pitch change (Live Editor has it), key and chords shown,
      count-in / metronome on the song's tempo.
      2026-11-12, the A-B loop: the player's menu has A–B loop (Loop starts here / Loop ends here / Clear the loop); at the end the
      song goes back to the start, from the position the player reports (`abLoop.ts`, no engine change, so the turn is a
      quarter of a second late on a file); it goes when another song starts. Left: chords shown (no source gives them: the key is the tag's, a column and Edit song info).
      2026-11-12, the metronome: the player's menu has "Metronome" (clicks on the audio clock at the song's tempo tag, else a typed tempo, 30 to 400
      BPM; it follows the tempo, not the song's beats; stops with another song). Decided alone (2026-11-12): no count-in (it would need to
      hold playback). Never tried by ear.
      2026-11-13, the count-in: the player's menu has "Count in, then play": the song waits (paused) while four clicks sound at its tempo
      (the tag's, else typed; at the speed it is heard, the Live Editor's included), then it plays from where it is
      (`countIn.ts`, the clicks are the metronome's). Decided alone (2026-11-13): four beats, no setting, an accent on the first; it
      holds playback by pausing, so nothing in the engine changed. Never tried by ear.
      2026-11-13, slow down: the player's menu has Practice speed (50, 75, 90 %, normal): the Live Editor's tempo, pitch kept, so the song's
      edit becomes a draft like any editor change (Reset undoes it). Decided alone (2026-11-13): four steps, no setting. Never heard.
      2026-11-12: the loop has a key (L: start, end, clear, in the shortcuts table) and a band on the progress bar. Decided
      alone (2026-11-12): L, one key cycling the three steps, rather than three keys. Never tried by ear or on a screen.
- [ ] `M-L` Profiles on one PC (each person's library, likes, history and Last.fm), switched from the top bar.
      2026-11-13 (wider mandate), still skipped: the first step is not the data model but the launch (which library file, which keychain names, which WebView2 profile are chosen before the window opens), the code the CI just showed a panic in; the owner's choices above come first.
      Skipped 2026-11-13 (night, not for this run): a profile is a second library file plus its own keychain entries and its own
      WebView2 cookies, chosen before the window opens, so a switch restarts the app; it touches `identity`, `rename.rs`'s folders and
      Sync Mode's per-PC files, and a wrong first step could mix two people's data. Needs the owner's choices (what is shared, e.g. local
      folders) before the data model.
- [ ] `L` Exclusive WASAPI output / bit-perfect for local files (foobar's audiophiles).
- [ ] `L` Podcasts by RSS (open feeds only: no platform audio taken), resume per episode, speed.
      2026-11-13, the first slice: Settings › Playback › Podcasts (off) adds Podcasts to the app menu: type an open feed's address, keep
      the show with its heart, play its episodes (`connectors/podcast.rs`: the feed read by hand, no XML crate, mockito tests;
      the audio is a ranged GET through the engine like a server song, `server:podcast:<address>`). Episodes of 20 minutes and more
      resume as any long song does; speed is the Live Editor's. Decided alone (2026-11-13): no directory search, no new-episode
      check, no downloads (a download is a copy of the audio; streaming only), no sidebar entry. 2026-11-13, second slice: Refresh on a show (reads the feed again; episodes not there the last time it was opened say New), played marks (a button per episode; starting one marks it; this PC only), OPML import (the exported text pasted; shows kept, no request made). 2026-11-13, third slice: Copy the list as OPML (clipboard). 2026-11-13, the background check: Settings › General › Check podcasts (off) reads each kept feed every six hours while the app is open (a minute after launch, 1.5 s between feeds, 30 shows at most, `podcasts/check.ts`) and a notice counts the new episodes; nothing is marked seen. The site's Podcasts privacy row says so. Never run for real. Never tried on a real feed or by ear; the privacy row says the feed host is reached.
- [ ] `L` Living-room mode: big UI driven by a gamepad or the arrow keys (10-foot layout), for a PC on a TV.
      2026-11-13, first slice: Settings › General › Living-room mode (off, this PC only): the page zoom is 150 % at least, the focus ring
      thick, the arrows move between the visible controls (`livingRoom/spatial.ts`, nearest in that direction; inside the open dialog),
      Enter presses a focused non-button, Esc goes back. Decided alone (2026-11-13): arrows and Enter/Esc only. Never seen on a TV. 2026-11-13, second slice: a gamepad (Gamepad API, standard layout, polled while the mode is on): d-pad or left stick moves, A presses, B goes back (`pad.ts`). Never held a pad.
      Left:
      a purpose-built home screen, the player bar enlarged beyond the zoom, on-screen keyboard for search.
      2026-11-13, third slice: an on-screen keyboard (Enter in a text field in the mode opens a grid of keys at the bottom, walked with the arrows or a pad; letters, digits, a few marks, space, delete, Done, Enter; lazy `livingRoom/OnScreenKeyboard.tsx`). 2026-11-13, fourth slice: a TV home (Settings › General › TV home, off by default; with the mode on, big tiles to Search, Songs, Albums, Artists, Mixes, Radio, Podcasts and Audiobooks when on, Settings; opens when the mode turns on, and in the app menu; lazy `livingRoom/TvHome.tsx`). Decided alone (2026-11-13): plain tiles, no cover rows, easy to replace by the owner's design. Never seen on a TV.
      2026-11-18 (lot 60): found that the TV home (fourth slice, `ac4ab854`) already is the dedicated home screen; added its Up next row (the next 6 queue songs as big tiles, a press plays that one; pure `tvQueue.ts`, tested). Left: the player bar enlarged beyond the zoom. Never seen on a TV; the arrows reach the new tiles through the existing `nextBox` map (not run for real). Decided alone (2026-11-18): no second focus-map function (`spatial.ts` `nextBox` already handles rows and edges, tested), the bar left alone (it needs a look on a real TV).
- [ ] `L` Media panel off Windows.

## Visualizer v2 (user's ask 2026-10-30: more realistic, more detailed)

First cut on Stable since 1.1 (`docs/playback.md`): 1/6-octave bands at 60 Hz from both twins, one canvas in a worker
drawn at 30 fps, eight looks (LED, Bars, Mirror, Peaks, Wave, Radial, VU needles, Spectrogram), the strip under the cover
and full screen on V. The lines left are in no milestone yet. Sorted like the features; both twins stay alike (`crates/dsp`
and `live.js`), and a look waits for the data it needs. Each look has a few settings: bands, smoothing, peak hold,
colours, mirror, reflection.

**High**

**Medium**

**Low**

## Workflow (how we build it)

Today: every green push to master is a Beta prerelease (479 commits so far, check 5-11 min then release 10-16 min) and
Stable goes out by hand (`promote`); the smoke test runs on every push; `src-tauri/src/lib.rs` 2149 lines; CLAUDE.md
~15 kB read by every session.

Most useful first; the tag is the effort.

- [ ] `M` The "Check live in the real app" list as a scripted checklist (a dev-only page that drives each step and logs the
      result), so a pass takes minutes, not a session.
- [ ] `S` Faster CI: run the macOS job only on pushes that touch Rust or `src-tauri`, `cargo nextest`, `sccache`; Linux
      job stays crates only.
      2026-11-13, skipped (can't be run here): skipping macOS needs a changed-files step in the matrix, and `release.yml`
      waits for `check` to succeed, so a skipped job must still count as green; nextest leaves doctests out of `pnpm check`
      (a second `cargo test --doc` step); sccache with rust-cache can cache twice. Each wants one try on a branch's CI.
      2026-11-18 (lot 55), the macOS skip only, NOT run (no CI here, YAML parsed only): `check.yml` › `check` gets a `scope` step
      (bash) after the checkout: on macOS it diffs the push's `before` (or the pull request's base) against HEAD and sets
      `run=false` when nothing under `crates/`, `src-tauri/`, `Cargo.toml|lock`, `rust-toolchain*` or the workflow itself
      changed; every later step carries `steps.scope.outputs.run != 'false'`, so the job still ends green (the release waits
      for `check` to SUCCEED: skipped steps are a success, the job is not skipped) and costs about a minute. Windows and
      Linux always run everything. It runs everything when the base is unknown (new branch, all-zero `before`, a failed
      fetch). What could break it: a base commit GitHub no longer serves (then it runs everything, by design), a step I
      gated wrongly (all 12 steps but the checkout and the scope are gated, read in the diff). Not done: nextest, sccache (they
      need a CI try each). Decided alone (2026-11-18): macOS only, Windows keeps the whole check (it is the release's gate);
      a front-end-only change is trusted on macOS because the same vitest and types run on Windows. Easiest undo: revert.
- [ ] `S` `graphify hook install` (the user's go) so the graph stays fresh without asking; then drop the `.gitattributes`
      line it adds (the graph isn't tracked).

## Optimisation (how it runs)

Most useful first; the tag is the effort.

- [ ] `S` YouTube embeds: measure what the second (hidden) embed costs, only if the owner's CPU or memory points at it.
      Already so: one embed plays a whole run of YouTube songs (`loadVideoById`); a second exists only for an overlap
      (two songs sound at once) or to hold Next's video cued (`cueNext`, 5 s into each song: Next is instant, the overlap
      takes it); stopped when idle (`stopVideo`); both gone when a song of another source plays.
      Decided alone (2026-11-18, lot 58): unloading the idle one not built. It is idle only seconds before `cueNext` reuses
      it, so a 20–30 s unload would almost never fire, or would undo the cued Next; recreated, its video never starts in
      the tray's hidden page (`overlap`, `holdPage`), the risk of a silent overlap. The CPU likely comes from the playing
      embed and its live chain, not a stopped one: unproven, to measure with the Task Manager before touching it.

## Check live in the real app (built and unit-tested, never driven for real)

- [ ] Connect Apple Music on the owner's account (the owner's ask to keep it in mind, 2026-10-31): All Playlists read with
      covers, a long library playlist and Favorite Songs read to their end, the `media-user-token` cookie ending the
      sign-in step, a second import updating the lists. If it breaks, `apple.js`'s selectors are the first suspect (only a
      public playlist page was seen).
- [ ] YouTube Music every 15 minutes: offered after a Google sign-in, runs while the app is open, silent on a refusal.
- [ ] A Legato link between two PCs: its videos come in named, no search.
- [ ] A SoundCloud song link pasted, and an `on.soundcloud.com` short link from SoundCloud's phone app: named, found on
      YouTube, added; a set's link says why it can't.
- [ ] Settings › General › Back up your library, then Restore a backup: the app restarts on it, playlists and history
      as saved, `library-before-restore.db` beside the library.
- [ ] A folder and a few songs dropped from Explorer: the folder in Settings › Accounts › Local files, the songs in the
      library after a restart, the notice's Play; songs already there play at once; a QR picture still opens a shared list.
- [ ] Start radio from an album, a playlist and the artist page, signed in to YouTube and signed out: its own songs one
      in three, Up next naming the radio, more songs coming at its end with autoplay off.
- [ ] The search bar's pages, actions and settings: "shuffle", "dark", "stats", Enter on each, in French too.
- [ ] Headphones unplugged, then a Bluetooth headset turned off, each while a song plays (YouTube, a local file): paused
      at once, the notice's Play goes on; with the setting off it plays on through the speakers.
- [ ] Windows' default output switched by hand while a local file plays, then while it's paused: it goes on (or waits)
      on the new device at the same place.
- [ ] Shuffle a playlist of a few artists: no artist twice in a row in Up next, the songs played today at the end.
- [ ] Mixes page at an hour you listened at on the same weekday two weeks running: "Your Friday evenings", in French too.
- [ ] A Teams test call with Pause during calls on, a song playing: paused as it starts, plays on as it ends. Also with
      Windows' Communications set to Do nothing (does Windows still say it?), and a call on another device.
- [ ] An album played from its first song with a fade set: no dip between its songs (YouTube Music album and local
      files), a playlist of singles still fades, the sleep timer's last song still fades out.
- [ ] "No sound could be taken" gone from the second YouTube video on (fix 51946d5).
- [ ] A real update from 0.1 (user's PC): Legato installed, old folder and its shortcuts gone, library, sign-ins and Open
      at startup still there.
- [ ] A real network cut (Wi-Fi off while a YouTube song starts): paused, one message, restarts on its own. Only emulated
      so far (DevTools cuts the page, not YouTube's out-of-process frame).
- [ ] Add to a YouTube Music playlist from an album page (cause of `STATUS_FAILED` assumed = duplicates); toasts + Undo
      / Add anyway; advanced fade by ear (curves, fade on skip, fade on pause); Home's YouTube Music shelves on a real
      account (unofficial API); Home items not in the library; new mixes after real listening; exact restore after an
      update.
- [ ] Tray menu actions, media keys on a real keyboard, add to a YouTube playlist the user owns, blocked video falling
      back, Auto on a real music video, resume after a real restart, sort Most played.
- [ ] Repeat one / repeat all at a track's end, menu actions that write (rename, delete, export, remove from playlist),
      local file covers, Apple cover backfill, Spotify covers, add another Google account, sign out.
- [ ] Landed the night of 2026-10-31, on Stable since 1.1, never seen on a real screen: Deezer and Apple links through the
      paste box (a real `link.deezer.com` short link too: tested on a recorded 302 only), Shift + wheel on a real mouse and
      the volume number, SponsorBlock turned on (a real intro skipped, Undo, marks on the progress bar), Skip silence across
      real crossfades, Karaoke on plain lyrics, with animations off, over a video in the watch page and at 60 fps on a long
      song (bench PC), a 10 000-song scroll asking only 64 px covers.
- [ ] One Liked Music (the owner's report, 2026-11-01: two in the sidebar after a Spotify import): yours, where imported
      likes wait for the YouTube account (its like refused here that day: 403), folded into the account's on every page
      (`features/library/likedMusic.ts`, the store's `raw` keeps both for the heart button and Remove from). Check: one
      entry in the sidebar, Home and search, the waiting songs on top of it, unliking one of them, a sync moving them over.
- [ ] A YouTube song that stayed black and silent until skipped away and back (the owner's report, 2026-11-01). Cause:
      Google's "Sorry…" page answers the embed's player request (403, after about 7 s) while it limits this PC's address,
      a third of the starts for hours after an import's 1840 searches (`diagnostics.log`: "YouTube refused searches | 125
      refused, 1715 answered"). `crates/shield/src/refused.js` tells the app at once: loaded again once (`playback` log:
      "Google refused the video, loading it again"); refused again, stopped with "Too many requests", nothing blocked, no
      watch page, no other upload searched. The clock waits for a new song's first report (it ran, nothing playing). The
      stuck check stays for slow networks (26 s). Check when it happens again: the log line, the song on about 8 s in.
      Imports now search one at a time, 3 s apart, and wait 5 min on a refusal (`searchpace::Pace`, the owner's call: an
      import of 1840 searches takes about 1.5 h instead of 30 min). Check on a real import: no `YouTube refused searches`
      line, playback fine meanwhile. Still fast: a pasted song list (6 at a time, `songlist.rs`) and Find versions (150 in
      a row, stops at the first refusal).
- [ ] The 2026-11-02 run (Beta 1.1.588), checked only by tests and over the demo:
      - Phone remote on a real phone (Settings › Playback): the QR code, the page, taps; Windows' firewall asks once.
      - OBS overlay in a real Browser Source; Settings › Privacy's real log of the day.
      - Pick up on the other PC (two PCs with Sync Mode): the toast once, then Resume in the idle player bar.
      - Cover display (C) on a real second screen; the display kept awake (WebView2's wake lock).
      - Share as a picture: a real paste into a chat app, a real save as PNG / JPEG.
      - Visualizer weighting and colour, by eye on real music (defaults unchanged); the cover's colour on real covers.
      - Library health page on the real library; Exportify's real names on a real export; the phone layout (a window
        under 640 px). Back to {month} shows only with months of history.
- [ ] The 2026-11-04 and 05 runs (the Beta of 2026-11-05), checked only by tests and over the demo:
      - Picture-in-picture (P) in the real window: small and above the others, dragged, back to a maximized or full
        screen one; a YouTube video in it; two screens.
      - The search on the real library: the order of your songs, a typo fixed, typing at 50 000 songs.
      - The alarm's real ring (from the tray, the PC awake or asleep); voice commands with real speech.
      - The taskbar's Jump List of an installed build; the recap's real save and copy; real tagged files (genre, year).
      - The accent from real covers; the Presets look with a real .milk file; "In the lyrics" on a real lyrics cache.
      - The phone's update on a real phone (from the Beta after 1.1.679): the toast, the download on mobile data and
        Wi-Fi, Android's permission page, its installer, the new version starting where the old one was.
- [ ] Against Liner (2026-11-05 on), checked only by tests and over the demo:
      - Keep the screen on (Settings › Playback › Screen): past Windows' screen timeout while a song plays, asleep as
        usual once paused; on the phone too (does Android's WebView grant the lock?).
      - The phone's interface (U1) on a real phone, light and dark: a long press and every ⋯ open a sheet, Android's
        Back closes it (and a dialog sheet) before leaving the page; the sheets and Now Playing clear the gesture bar
        and the notch (safe-area insets); the keyboard over a dialog sheet (a playlist's name) leaves its buttons
        reachable; every icon button answers a thumb's tap at its edge; Settings › More settings opens and a settings
        search opens the right fold; the mini player opens Now Playing on a tap, its heart and play don't. Judge the fold
        list and the moved controls (Reset history, previous only in Now Playing).
      - Glow and simplicity (U2): Settings › Appearance › Player › Glow at Off, Soft and Strong, in a dark and a light
        theme: the play button, the playing row's mark, the seek bar's played part, a switch that's on, the sung line,
        Now Playing's cover on a few real covers (a grey one: no glow); Off leaves nothing. More glow without too much?
        Does a song change stay smooth with Now Playing open (Task Manager's GPU column)? The player bar's More (picture
        in picture, sleep timer…), Now Playing's More (Karaoke, Cover display, Less like this), the moon back while a
        sleep timer runs, Back / Forward appearing once you've moved, Your library's Expand and Sort under the pointer.
        Judge the calmer look: anything missed is one class to put back.
      - Listening rooms (17, local half), a PC and the phone on the same Wi-Fi: the room shows in Join a room within
        3 s on both sides; the code and the QR join (a wrong code says so; 5 of them change the code); the listener
        starts the song within a few seconds and stays within 1.5 s of the host (pause, seek, next on the host); a
        song only on the host's disk is found on YouTube on the listener's side, or says "Can't find this song here";
        own pause and Catch up; skip on the listener says it follows the room; reactions float on both; End room and
        Leave; the host closing the app ends the room on the listener ("The room's host left"). Windows' firewall asks on
        the first room (TCP 47823): does a refused prompt leave a clear error? Android in the background: does the room
        keep up with the screen off? Settings › Privacy lists nothing new (no host is talked to).
      - Your music server (personal servers, part 1), with your own Navidrome (`docs/development.md` › Your music
        server): Sign in with its address, user and password (a wrong password says so; an address that isn't a server
        says so; a public http:// address shows the warning); the first sync brings its songs, albums and playlists
        (how long for your library? does the app stay responsive?); a song plays, seeks forward and back, hands over to
        the next without a gap, the Live Editor and the visualizer work on it; its cover shows; a like stars it in
        Navidrome and an unlike unstars it; a song played past half shows in Navidrome's recently played (and only
        then); Wi-Fi cut mid-song: it picks up or says "stopped sending"; an opus or other unusual file plays (the
        server's MP3); Sign out takes its songs away; Settings › Privacy lists the server's address. On the phone over
        Wi-Fi: the same song plays and seeks.
      - Jellyfin (personal servers, part 2), with your own (`docs/development.md` › Jellyfin and Plex): Server type
        Jellyfin, its address, user and password (a wrong password says so; a Jellyfin older than 10.9 says so; an Emby
        or a web page says it isn't a Jellyfin); Dashboard › Devices shows "Legato on Windows"; songs, albums,
        playlists and favourites come in; a song plays and seeks (a FLAC raw, an opus as the server's MP3); a like is a
        heart in Jellyfin, an unlike removes it; Dashboard › Activity shows the start and the stop; a song played past
        half adds to its play count (and one skipped early doesn't; one played to its end counts once, not twice:
        Jellyfin's own Stopped may count a play past 90 %, then `UserPlayedItems` adds one); Sign out removes the device
        from Jellyfin's list and the songs from the library.
      - Plex (personal servers, part 2), with your Plex account and server: Server type Plex › Sign in with Plex
        opens app.plex.tv in your browser with the code shown in the app; after you allow Legato there, the app goes on
        by itself within a few seconds (several servers: a picker; a shared one says "Shared with you"); Cancel stops
        it; a code left alone expires with a message. Songs and playlists come in (how long for your library?), covers
        show, a song plays and seeks; a like is 5 stars in Plex, an unlike clears them; a song played past half shows
        in Plex's history; away from home (phone on mobile data, or the server's port closed) does the row say Plex's
        relay, and does it play? Back home, the next sync leaves the relay by itself. Does `/identity` answer without a
        token (the sign-in finds the server)? Settings › Privacy lists plex.tv, the server's plex.direct address,
        nothing else.
      - The phone's fixes from your tries (2026-11-06, reviewed the same evening): Back from a playlist goes to the
        page before, at the root the app goes behind and the music goes on; Back closes a sheet, a dialog, the lists' i
        box, the visualizer, Karaoke and Now Playing first. A YouTube song outside Now Playing: no video over the lists,
        the sound on, Now Playing shows the video. The app opened on a Wi-Fi with no internet (a hotspot without data),
        a YouTube song played: Now Playing says "Can't reach YouTube…" with Try again, never the error page; the song
        isn't skipped, and plays by itself once the internet is back. (The internet lost mid-song with the Wi-Fi still
        up is another path, untouched: does it skip?)
      - Against Liner 3 to 5 and the round covers (2026-11-06 evening, Beta 1.1.750 by the dry run). Discord, Song and
        artist: "Listening to jinx – lexycat", the album under it; a YouTube song played 10 s shows the artist's small
        picture on the cover's corner, on a friend's screen too. Settings › General › Picture-in-picture on minimize:
        the title bar's minimize, Win+Down, a taskbar click and Win+M while a song plays open the small window (does
        the window show going down first?); that one minimized and restored from the taskbar gives the full window
        back; the sung line under the picture. Settings › General › Storage: do the sizes look right, does Clear on
        Lyrics and song analyses and on Diagnostics log free them (how long on your library?), is WebView2's size
        there? The radial look, and vinyl covers, on a YouTube upload with a 16:9 picture: round, the ring around it.
      - The 2026-11-07 work (the night's Beta: Against Liner 7, 9, 10 and the lyrics on the backdrop; then the
        autonomous run's local commits, not pushed yet: 13, 14, the website). Stats › Recap's last card, "My music
        profile": its numbers, top artists and playlists right, the saved picture. An import with doubtful matches: its
        end lists them, the videos side by side; a pick sticks, Approve all keeps the rest. Next 10 s into a YouTube
        song: quicker than before? (Copy diagnostics: the "time to sound" lines.) Now Playing's lyrics readable on a
        light cover? A big playlist's import (yours to run): the lists there at once, a song not looked up yet found as
        it comes up to play, the import screen's count going down; does YouTube refuse sooner than before? A song from
        your Navidrome or Jellyfin that has lyrics: the server's own first; the lyrics' source line › Other lyrics: the
        choices with their %, a pick kept after a restart and after the caches are cleared, Let Legato choose. The
        website once deployed: the story on your phone in the phone's layout; /legato/fr/ in French, the header's
        language picker.

## Waiting on the user (outside the code)

The owner's answers (2026-11-07, a quiz over the open questions; the lines they changed say so). Kept as they are: on
the phone a YouTube song plays out of sight outside Now Playing, SponsorBlock off by default, the volume curve, star
ratings in the library only (not in the files' tags), imports at one search per 3 s, no checking of every YouTube
video ahead, no Spotify previews, Android as the APK with its own updates (no Play Store).

- [ ] Plex's Terms of Service (plex.tv › About › Privacy & Legal): the page refused an automated read (2026-11-06), so
      nothing in them was checked. Sign in with Plex follows the PIN flow developer.plex.tv documents for apps, on the
      user's own server; whether Plex's terms say more about third-party apps is your read. Also your call: trying
      it with your account (`docs/development.md` › Jellyfin and Plex).

- [ ] Discord shows "Listening to Music App": that's the name of the app on Discord's developer portal (rename it there).
- [ ] Trademark search for Legato (INPI, EUIPO, USPTO classes 9, 41, 42).
- [ ] Figma: muted text (ink3) light is #606060 in the app (AA on cover tints), #6B6B6B in the file. Rename the file
      "Legato · Design" (the plugin can't rename files).
- [ ] Spotify: try Ctrl+A, Ctrl+C on a private playlist in the desktop app and paste into Notepad (links, one per line?).
- [ ] Spotify: ask for the data export (Privacy settings › Download your data); its `Playlist1.json` is the test file:
      open the ZIP in Add music › Connect Spotify › Open Spotify's data export (are private playlists in it?).
- [ ] A playlist file from foobar2000 / VLC / MusicBee, and an `iTunes Music Library.xml`, through Add music.
- [ ] Quit the installed Legato from the tray and open it again: a session closed its hidden single-instance window by
      mistake on 2026-10-31.

## Not done yet

**Spotify** (no keys; the user chose link import)
- [ ] Keep or remove the Spotify app-key path (Settings › Accounts). User's call.
- [ ] Real playback in the web player window (user signs in first).
- [ ] Only if the user asks: ad blocking (ToS / account risk first).
- [ ] Needs paid accounts: Spotify Connect for real (Premium), MusicKit (Apple Developer).

**Housekeeping**
- [ ] Playlist `trackCount` vs rows mismatch (Workout Mix).
- [ ] "Music App export test" playlist on YouTube Music: ask before deleting.
- Dependabot alert #1 (`glib` 0.18, Linux only, through Tauri's GTK3 stack) dismissed: re-check at each Tauri upgrade.

## Fixed limits

- Never download or extract YouTube or Spotify audio. Hidden player: only Now Playing's Cover mode, the user's choice
  (2026-10-16) against YouTube's terms; everywhere else the video stays visible (minimum 200×200).
  2026-11-18, the owner's choice, also against those terms (the phone's since 2026-11-06): a YouTube video shows only in Now Playing, or in the mini player when that is on (off by default); no longer forced on screen elsewhere (`miniRule.ts`).
- No circumventing Premium or DRM. Quotas respected, no server of ours.

## Left open (what the ticked lines still leave)
- [ ] `S` Visualizer style previews: they use the visualizer's own painter (`VizThumb.tsx`), not the real sound.
- [ ] `S` Remove from a playlist: check it on YouTube Music and server playlists too (only local ones were checked).
- [ ] `S` Crossfade: check that a refused embed (or the crossfade's other player) never keeps sounding once the watch page takes over.
- [ ] `S` Share page: no covers and no player yet (covers would load from YouTube's host for the visitor).
- [x] `S` Stats recap cards. Ticked 2026-11-18 (lot 63, audit of the line): the recap shipped (`812a8d96` a year or a month as cards to share, `d725d9fe` the profile card; `features/stats/RecapView.tsx`, `recapCards.ts`, `recapDraw.ts`, tested in `recap.test.ts`). What the line still asked is a try by hand (the card from the web page, the QR's look and size): Check live.
- [ ] `M` Whole-app security pass (for Opus).
- [ ] `S` Signed-out YouTube search: check it on the owner's PC; if it still fails, read the error under the search.
- [ ] `S` Settings labels: review the descriptions' length and read the labels in the app in every language; the JSX per group is optional.
- [ ] `S` Server songs levelled: Jellyfin's `NormalizationGain` and Plex's loudness are not read yet (other scales).
- [x] `S` Discovery: covers from the Cover Art Archive (one more host) are not done. Done: `79492349` (an option, off by default).
- [ ] `S` Streamed songs: genre, year and tempo are not filled (no source gives them without a new host).
- [ ] `S` Last.fm "Discoveries": left for the owner (its public API has changed).
- [ ] `S` Internet radio: a phone tab, and the station's own metadata (no ICY).
  2026-11-18 (lot 63): the phone tab is done: Radio is the 5th bottom tab (`PhoneTabs.tsx`, the lit tab chosen by the pure `tabLogic.ts`, tested), since the sidebar that holds Radio is hidden on a phone. Untried on a phone (5 tabs at 375 px). Left: the station's own metadata (ICY, a stream read: needs a real station).
- [ ] `S` Focus / workout sessions: the session itself (timer, no-lyrics filter, summary) is left.
  Audit 2026-11-18 (lot 63): the timer (the sleep timer's fade) and the summary ("N songs in M min") already shipped in `player/focus.ts`; only the no-lyrics filter is left, and no library field says a song has lyrics (they are fetched per song), so it needs a data source first: the owner's call.
- [ ] `S` Smart playlists from words: the LLM half, with the user's own key, is left for the owner (a service and a privacy row to decide).
- [ ] `M` Blind test: left out, the artist-only guess, the answer timer, several players (local or LAN), a game from one playlist.
  2026-11-18 (lot 63), the answer timer: a round now lasts 30 s from the start of its snippet (`ANSWER_MS` = the 20 s snippet + 10 s); with no answer by then it ends, shows the song and scores nothing, and a thin line along the answers runs out (`blind-clock`, a transform). Pure `pointFor` / `TIMED_OUT`, tested. Decided alone (2026-11-18): no speed bonus (taste), no new text (the existing "It was …" line is the reveal); easiest undo: remove the effect in `BlindTest.tsx`. Never played in the app. Left: the artist-only guess, several players, a game from one playlist.
- [x] `S` Typed `invoke` wrappers: the argument names and types are not checked by a test yet. Done 2026-11-18: `ui/src/shared/apiCommands.test.ts` reads `shared/api.ts` and every `.rs` under `src-tauri/src`, and fails when an `invoke('<cmd>', { … })` names a command that is not in `generate_handler!` or not defined by a `#[tauri::command]` fn, passes a key that command's parameters do not take (Rust snake_case read as Tauri's camelCase; `State`, `AppHandle`, `Window`, `WebviewWindow` left out, `Channel` kept) or leaves out a required one (an `Option` may be omitted); and when `generate_handler!` registers a name no command defines. Names and keys only, no types (ts-rs owns those). It found NO mismatch: the 279 wrappers all agree with the 280-odd commands today (checked that it can fail: a renamed key in `ytmArtist` is reported, then restored). No other file calls `invoke` outside tests. NOT done: the types of the arguments and the answers. References read: `ui/src/shared/api.ts`, `src-tauri/src/lib.rs` (`generate_handler!`), the command signatures under `src-tauri/src` (State and AppHandle parameters, `Option` ones).
- [x] `S` Library scan progress: a small `M` with its own Channel, not started. Done 2026-11-18 (small): the Local files section of Settings › Accounts (`SourcesView.tsx`) now shows "Reading your files… {done} of {total}" with a thin bar under its folders while a scan runs, from the SAME report the Songs page already follows (`scan-progress`, `useScan`, sent by `rescan` every 200 ms at most; the text already exists in the 19 locales, nothing to translate). Found while reading: the progress already existed as an app-wide event, fired by every scan (the rescan button, adding or removing a folder, the folder watcher, a drop), and Songs showed it; only Settings did not. Decided alone (2026-11-18): NOT a new `tauri::ipc::Channel` on `rescan` / `rescan_local` as the line said: a Channel serves only the call that opened it, so the watcher's and a drop's scans would stay silent and the same count would be sent twice; the event reaches every window part that wants it, which is what both screens need. NOT seen on screen: the demo emits no scan progress, so the bar was checked by `tsc` and lint only, not by eye; `progressOf` and the store keep their existing test. References read: `src-tauri/src/library_cmd.rs` (`rescan`), `ui/src/features/library/scanProgress.ts` (+ test), `LibraryView.tsx:285-302`, `SourcesView.tsx` (Local files), `viz.rs` (`viz_start`, the Channel prior art).
- [ ] `S` Hide explicit songs: untried on real answers (YouTube Music's page rows give no flag).

### Personal servers (what is left)
- [ ] `S` Plex's Sign out ends nothing at Plex: the account's token is dropped at the pick, and an owned server's
  token can be the account's own; Legato stays in plex.tv › Authorized Devices until the user removes it there
  (the privacy row says so). Revoking it needs the account token kept, or a documented device-removal call.
  Skipped 2026-11-11 (decided alone): the repo knows no documented removal call (developer.plex.tv's API reference has
  none for a device; the one clients use, `DELETE plex.tv/devices/<id>.xml`, is the legacy undocumented one), and
  it needs the account token, which is dropped at the pick on purpose (only the server's own token is kept). Keeping
  the account token longer widens what a keychain leak gives: not for a call we can't check. The privacy row already
  tells the user to remove the device at plex.tv.
- [ ] `S` Plex's JWT sign-in (clients.plex.tv, a device key pair, the token refreshed each week) if Plex retires
  the legacy PIN's long-lived tokens.
- [ ] `S` Your music server in the app's search (`Conn::search` built for the three kinds, not wired). Decided alone
  (2026-11-06): left for later; the library mirrors the whole server at each sync, so its songs already come
  up in the library's own search; the server's search would only add what came since the last sync.
  Skipped 2026-11-11 (decided alone): nothing a user would see beyond that gap (songs added in the last 30 minutes),
  while wiring costs a server request per search on every account and a "not in your library" result kind that
  plays without being in the library. Revisit if a sync gets slower than 30 minutes.
- [ ] `S` Playlist edits sent back to the server (`updatePlaylist`, `createPlaylist`) when its direction sends.
  2026-11-11: a Subsonic server's playlists take songs (Add to playlist, a drop on the sidebar) and lose them
  (Remove from) from here, sent with `updatePlaylist` in the background and undone here when refused; a
  removal reads the server's list first (it removes by position). 2026-11-13: `createPlaylist` too (a playlist made
  here: menu "Send to <server>", every song must be that server's, then it is mirrored from that server and the
  next sync finds it by its id). Left: renames and order, Jellyfin and Plex (read-only, said in words). Untried on a real
  server: mock tests only.
