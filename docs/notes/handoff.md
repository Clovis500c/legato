# Handoff

Where the work stands, for a session or an account with no history here. Read this, then `CLAUDE.md` (rules, map of the
code), then [plan-v2.md](plan-v2.md) (open work). Rewrite it when a branch or the next step changes.

Written 2026-11-01, run section 2026-11-02, autopilot 2026-11-03 and 2026-11-04.

## Autopilot from 2026-11-04 (relaunched by the owner the same morning: read this first)

The owner's ask (2026-11-03 evening): carry on with the plan and the Android app, a lot to do, alone from the weekly
reset (2026-11-04 08:00 Paris), resuming alone after each 5-hour limit; no question can be answered. The desktop app's
scheduled task `legato-autopilot` opens the session once (08:06); that session keeps itself going with a CronCreate
wake-up every 20 minutes (session-only: an app restart ends the run until the owner is back).

Rules on top of `CLAUDE.md` (the 2026-11-02 run's, which worked):

- Never a question, never a wait. A choice that's the project's: take the option easiest to undo and write it in its
  plan line, "decided alone (date): what, why". What only the owner can do goes under Waiting below; then the next step.
- One step = code and tests, `pnpm check` green, one local commit on `platforms`, its plan line ticked with what wasn't
  tried for real, a line in the log below, then `get_usage`. No push, PR, merge, release or website deploy.
- Alone: no subagents, no workflows (the owner's 2026-11-02 choice wanted their price said first; nobody can hear it).
- Weekly limit: from 90 % no new step, finish the one in hand, then the end; 95 % at the latest. 5-hour limit: work on,
  the wake-up resumes after its reset. A cut leaves at most one step's edits: finish them or stash them, never drop.
- Untracked `docs/notes/report-*.md` are the owner's reports: never committed.
- Android: `. C:\dev\android\env.ps1` first; emulator `legato36` headless (`-no-window -gpu swiftshader_indirect`),
  stopped once the test is done. Between the emulator and the dev app: `adb reverse` over loopback. Never answer
  Windows' firewall or any system prompt. No Google sign-in or consent page anywhere; YouTube signed out, a few plays.
- The end (the order done but the owner's lines, or 90 % of the week): `docs/notes/report-<date>.md` in French (tu, like
  `report-2026-11-02.md`: done, to try, waiting for the owner, how it went), this file rewritten, the wake-up deleted
  (CronDelete), the report sent with SendUserFile (proactive).

Order (the owner's latest asks first; Mobile below has the details):

1. The device sync carries every setting but each device's own (Mobile › First next).
2. The phone's other texts and screens: desktop-only Settings rows hidden there, strings that still say PC.
3. Controls in the notification and on the lock screen: a MediaSession (play / pause / next / previous, cover, title),
   the Android twin of `media.rs`; Back on Android 8 to 11 sends the app to the background.
4. The QR scanner (`tauri-plugin-barcode-scanner` reading `legato://pair?`; its licence and version checked first).
5. Secrets in Android's Keystore, moved once from `secrets.json`.
6. An Android download on the website (`site/`, the latest Beta's APK, privacy rows kept true): local, a push deploys it.
7. Then plan-v2's open lines that need no account: Features › Medium, Visualizer v2 › High `S` lines, Optimisation, Low.

Waiting for the owner: background play behind other apps on their phone; the phone and PC sync once step 1 lands; the
iPhone's signing (Apple Developer Program or an unsigned .ipa); Play Store or not; a backup of `C:\dev\android\signing`;
the next Beta (a push).

Log (newest last):

- 2026-11-03: set up (this section, the scheduled task); nothing run yet.
- 2026-11-04: step 1 (device sync and settings). Cause found by reading: a PC with one stamped setting never stamped the
  rest (`settings_unstamped` looked at an empty table), so its other settings travelled as time 0 and no device took
  them. Now any unstamped key counts; more per-device keys in `LOCAL_SETTINGS`. Unit-tested; not seen between two
  real devices.
- 2026-11-04: step 2 half (phone screens). Desktop-only Settings rows and the Shortcuts section hidden on the phone
  (`features/settings/desktopOnly.ts`, also out of the search). Strings that still say PC (player offline notice, Stats,
  Mixes, Sync Mode texts…) left: each phone variant needs 17 translations. Decided alone: later, with step 7.
- 2026-11-04: step 3. Notification with previous / play-pause / next, title and artist, plus a MediaSession for the
  lock screen and headset (`PlaybackService.kt`, `MediaState.kt`); the page talks to it through androidx.webkit's
  web message listener `LegatoMedia`, allowed for `tauri.localhost` only (YouTube's frames can't reach it); page side in
  `player/media.ts`. Back on Android 8 to 11 moves the app to the background. Built and started on the emulator
  (session registered, no crash); buttons and a real playing song not tried. No cover in the notification yet (the
  art scheme is the page's; native fetch would need the cover bytes pushed).
- 2026-11-04: step 4. QR scanner: `tauri-plugin-barcode-scanner` 2.x (Rust 2.4.5, JS 2.5.3; MIT / Apache-2.0; the 3.0
  alpha avoided), phones only, capability `mobile.json`; Add a device › Enter a code › Scan a QR code pairs from the
  other device's `legato://pair?` link. Starts on the emulator (CAMERA declared, not granted); never scanned a real code.
  Camera permission: asked at the first scan. Privacy rows: the scan stays on the phone, nothing to add.
- 2026-11-04: step 5. Secrets sealed by an AES key in Android's Keystore (`KeystoreCrypto.kt`, JNI glue
  `mobile/keystore.rs`, R8 keep rule): `secrets.bin`, the old plain `secrets.json` sealed and removed at launch (kept if
  the Keystore refuses). Checked on the emulator: a planted JSON became a 54-byte sealed file, no plain text, stable over
  a restart. Not tried: a real phone, a restored backup (key gone: sign-ins asked again).
- 2026-11-04: step 6. Website: "Android beta (APK, version)" beside the Windows version line in the hero (`useAndroid`:
  the newest of the last 10 GitHub releases with a `_android-arm64.apk`, else the releases page) and an FAQ answer
  (Android 8+, 64-bit, no store, no updater, iPhone not yet). `next build` passes; a push deploys it, the owner's call.

First end (2026-11-04 08:48, week at 2 %): steps 1 to 6 done; step 7 not started (its lines seemed to need the owner's
eye, a new service or an account); report `report-2026-11-04.md`.

Relaunch (2026-11-04 morning, the owner on the phone: « Tu relance tout faut faire le max »): everything that can be
built and checked alone, until 90 % of the week, in the owner's own session (followed over Remote Control), same rules,
same 20-minute wake-up. What the first end left is in scope now:

- A line that needs the owner's eye or taste: built behind a setting that's off, or a default that changes nothing, so
  the owner judges it later (the plan line says which).
- A new service (a new host): opt-in, by `.claude/skills/add-connector` (mock tests, the website's privacy row); a few
  real requests to check its endpoint, never bulk.
- Only what truly needs the owner waits: a real account or sign-in, their phone, ear or PC's hardware, a push, a paid
  program.

Relaunch order: (1) a signed APK of `platforms` sent to the owner, version 1.1.(commits in HEAD), above Beta 1.1.609 so
it installs over it, and below the next Beta (it counts master's commits); (2) the cover in the phone's notification;
(3) the phone's texts that still say PC (Sync Mode, Music Detector, plugins); (4) plan-v2's open lines: the roadmap's
order, then `S` before `M` before `L`, phone and visualizer first.

Relaunch log (newest last):

- 2026-11-04: (1) APK 1.1.621 signed (`--config` file with the version: PowerShell 5.1 mangles inline JSON), sent to
  the owner. `tauri.properties` is rewritten by the build: restored after.
- 2026-11-04: (2) the cover in the notification and on the lock screen. The page's `fetch` to `art.localhost` fails on
  Android (the CSP), an `<img>` loads: `phoneCover` draws the 256 px thumbnail on a canvas (the scheme allows any
  origin) and posts `{"cover": base64 JPEG}` after the state; `MediaState.kt` decodes it, a new title clears it;
  `PlaybackService.kt` puts it in the metadata and as the large icon. Seen on the emulator (API 36) with a title
  pushed over DevTools; a real song's path not driven.
- 2026-11-04: (3) the phone's wording: 9 new texts in the 18 languages, 3 generic "device" ones in place of PC ones.
  Also fixed: French phone texts of the first run said « tu » and « Réglages » (the interface says « vous »,
  « Paramètres »). The Detector on the phone: microphone only, no Windows settings link. Still no `RECORD_AUDIO` in
  the manifest: the Detector can't hear on the phone yet (next step).
- 2026-11-04: the Detector hears on the phone: `RECORD_AUDIO` in the manifest, a `LegatoMic` web message listener in
  `MainActivity.kt` ("ask" → Android's dialog, "yes" / "no"; "settings" → Legato's app info), `phoneMic.ts` asks before
  each listen. Driven on the emulator over DevTools (`click.mjs` clicks by text): refusal, app info, one-time grant,
  recording started and stopped. The emulator's host microphone stays off: never turn it on (it would hear the room).
- 2026-11-04: the phone's paste hint says the search box (`youtubeLink`: only a link, so "youtube rewind" stays a
  search), the shared-playlist card drops the QR screenshot drop, Discord never starts on a phone. Unit-tested, not
  driven on the emulator (a YouTube link would cost a real request).
- 2026-11-04: the owner, mid-run: « faudrait vrm bien gérer les ui et leur texte et le responsive prcq la c pas ouf ».
  Next after the visualizer gradient: a pass over every screen at phone size (the emulator, and the demo at 375 × 812)
  and in a narrow window: cut texts, overflow, cramped rows, wording. Seen already: the phone's top search bar cuts its
  placeholder ("What do you want to pl").
- 2026-11-04: visualizer gradient (plan-v2 › Visualizer v2), off by default; seen over the demo (`demo` in launch.json,
  `?shot=visualizer&p=0&theme=modern-dark`, right-click › Visualizer gradient).
- 2026-11-04: the owner on 1.1.621: the music stops behind other apps and screen off. Reproduced on the emulator (the
  page paused 25 s after Home, the service still up): Chromium pauses a hidden page's videos. Fixed in
  `MainActivity.kt` (`setContentView` wraps wry's WebView in `KeepVisible`: wry calls `onWebViewCreate` before it puts
  the WebView on screen, so a reparent there finds no parent), `PlaybackService.kt` (`hold`: wake lock + Wi-Fi lock
  while playing), `WAKE_LOCK`, and Back (always behind: Android 16 finished the activity when not opened from Home, and
  the process exits with it). How to check it: the YouTube frame's `<video>` over DevTools (`Page.getFrameTree`, then
  `Page.createIsolatedWorld` on the frame and `currentTime`, `paused`); `dumpsys deviceidle force-idle` after
  `dumpsys battery unplug` for Doze (then `unforce`, `battery reset`).
- 2026-11-04: APK 1.1.628 with that fix sent to the owner. Then the UI pass (plan-v2 › The interface's texts and layout
  at every size), five commits: the phone's Home, lists, Mixes, Stats, Settings and Accounts; a desktop window under
  1200 px (right panel aside, song columns fitted). Checked in the demo (`demo` in launch.json, the pane's mobile
  preset for 375 × 812, a custom size for a narrow window; reload after a size change, `phoneApp` is read at load).
  Then search results and the album / artist song rows on the phone (two more commits). Next in it: Now Playing's
  panels on the phone, Add music, then the emulator.
- 2026-11-04: the UI pass on the emulator (a debug APK, screens over DevTools: `adb forward` to the WebView's socket,
  `adb shell screencap`, `input tap`). Found and fixed: the styled scrollbar stayed on screen (Android's own now), the
  paste hint cut, and the sign-in windows: Connect Spotify opened Exportify full screen over the app with no way back
  (`am force-stop` was the only exit), so on the phone Spotify's, Apple's and Google's sign-ins and the folder give way
  to a From your PC card. Found, next: every file picked or saved on the phone fails (`content://` addresses), and
  local music needs its own path (plan-v2, two new Android lines).
- 2026-11-04: files on the phone: every file dialog through `shared/files.ts`, Android's `content://` addresses copied
  through the app's cache (`picked.rs`, `PickedFile.kt`). Seen on the emulator (API 36): a theme saved to Downloads through Android's save screen, then opened back from it (copied in under its own name); the other dialogs not driven one by one, nor a real phone.
- 2026-11-04: the phone's own songs: `READ_MEDIA_AUDIO` (8 to 12: `READ_EXTERNAL_STORAGE`), a `LegatoMusic` listener
  in `MainActivity.kt` ("ask" / "check" → the Music and Download folders as JSON, or "no"), `phoneMusic.ts` (a Music on
  this phone card in Add music and the welcome, Local files' row finds them, scanned again at launch). Seen on the
  emulator: the dialog, a refusal, a WAV pushed by `adb push` found with its tags, the watcher (about 6 s), the Rust
  engine behind other apps and screen off. A silent file ends at once (`ends.ts`' silent end): test with a quiet tone.
- 2026-11-04: the owner, mid-run: « quand on ferme le tel ou qu'on le met en veille ya un petit délai pour que la music
  se joue ». Measured with `gap.mjs` (scratchpad: the YouTube frame's `<video>` events over DevTools, kept in a DOM
  attribute since isolated worlds don't share globals): Home gave `pause` → `play` 0.8 s apart and a 3 s stall, screen
  off 0.27 s. Cause: wry's `onPause` calls `WebView.onPause()`, and Chromium pauses the media then, before our resume.
  Fixed by emptying wry's private `mWebView` field (by type; `onPause`, `onResume` and its Back check
  `isInitialized`), Back by our own `OnBackPressedCallback`, the field put back for `onDestroy`. After: no event at all.

## Mobile app and devices sync (the owner's ask, 2026-11-02 afternoon; in progress)

The ask: the mobile app working completely; phone and PC synced over Wi-Fi both ways (code or QR code, either device
first), devices listed with icons and here-or-not, trusted devices (no code again), sync automatically; then a Beta
with the APK (and the iPhone build). The owner's choices (2026-11-02): alone until 95 % of the week, then workflows after
the weekly reset (2026-11-04 08:00 Paris): one agent at a time, effort high, the price first, under 30 % of the 5-hour
window; Android first, the iPhone once the owner picks its signing (Apple Developer Program or an unsigned .ipa); the
Android SDK / NDK / JDK 17 on this PC (the owner's OK, about 10 GB) to test on an emulator; YouTube signed out on the
phone, the library from the PC by sync.

Done on `platforms` (not pushed): the spec ([sync-mode.md](../sync-mode.md) › Your devices on the same network), the core
and the wire (`cd62b11`), the shell `src-tauri/src/devices.rs` and Settings › Sync Mode › Your devices (`Devices.tsx`),
the one-off swap's commands gone (`syncmode::join` stays as the fallback for an older Legato's code). Unit-tested; never
run between two real devices, nor seen in the real app (Windows will ask once about the firewall for TCP 47822). Seen in
the demo at phone width with invented devices (`dd048dc`: the notes wrap, the countdown starts at 10:00).

Android tools, done (2026-11-02 evening): `C:\dev\android`, about 8 GB (JDK 17, SDK, NDK r30, emulator and an API 36
image, versions in plan-v2), Rust's Android targets; installing them accepted the Android SDK licence. The JDK came as
Microsoft's zip rather than winget's MSI: no admin prompt, no PATH change. Outside AppData because Claude's shell sees a
virtualized one. Nothing persistent: dot-source `C:\dev\android\env.ps1` before an Android build. A hypervisor runs on
this PC (Ryzen 5 5500, 32 GB), so the emulator should start; not tried yet.

Android, first run (2026-11-02 evening, the owner asked for it now): `src-tauri/gen/android` (Tauri's project; identifier
`app.legato.mobile` and Android 8+ for AAudio in `tauri.android.conf.json`), a debug APK that starts on the emulator and
shows the phone layout (AVD `legato36`, Android 16; headless: `emulator -avd legato36 -no-window -gpu
swiftshader_indirect`). What it took: reqwest on rustls + ring + Mozilla's roots on Android (`tls()` in connectors,
plugins and shield; native-tls elsewhere); desktop-only shell parts behind `#[cfg(desktop)]` (updates, single instance,
window place, global keys, tray, the watch page), phone twins in `src-tauri/src/mobile/`; third-party plugins desktop
only (rquickjs ships no Android bindings); no WebView cookie read on phones (Android's WebView threw on a page with no
cookie and aborted the app); `MainActivity.kt`: the multicast lock (mDNS) and the page kept clear of the system bars;
the phone's name from its system properties. Build: `. C:\dev\android\env.ps1; pnpm tauri android build --debug --target
x86_64 --apk`, then `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.

Release APK (2026-11-02 night): `. C:\dev\android\env.ps1; pnpm tauri android build --target aarch64 --apk` →
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` (25.5 MB, arm64 only), signed
when `src-tauri/gen/android/keystore.properties` exists (out of git: `storeFile`, `password`, `keyAlias`). The
keystore is `C:\dev\android\signing\legato-release.jks` (alias `legato`, a copy of its properties beside it): lost,
and phones can't take a later APK without uninstalling, so the owner backs it up. No updater on phones (desktop only):
a new APK installs over the old one. Secrets on Android: `secrets::FileStore`, one `secrets.json` in the app's private
data folder. The signed APK starts on the emulator (arm64 under translation) and shows the welcome; sent to the owner
to try on their phone, never run on a real one yet.

Phone texts (2026-11-02): `shared/platform.ts` `phone` (the WebView's user agent); the welcome, Settings › About and
Privacy and the player bar say phone instead of PC there, and the welcome hides its Google sign-in promise. The APK in
every Beta: `release.yml`'s last step builds it on the Windows runner (the runner's SDK and NDK,
`ANDROID_NDK_LATEST_HOME`), signs it with the repo's Actions secrets `ANDROID_KEYSTORE` (the .jks in base64) and
`ANDROID_KEYSTORE_PASSWORD` (store and key; alias `legato`; the owner's OK, 2026-11-02) and attaches
`Legato_<version>_android-arm64.apk` to the versioned release. It runs after the Beta pointer, so a failure there never
holds the Windows Beta back. First one: v1.1.603 (2026-11-02), signed with the same key as the APK built on this
PC (it installs over it); Android's own third-party notices from the next Beta on (`notices.mjs aarch64-linux-android`).

Background play on the phone (2026-11-03, the owner's request; against YouTube's terms, background play being a
Premium feature, said): `PlaybackService.kt`, a `mediaPlayback` foreground service started by `MainActivity` while on
screen, stops itself within a minute once off screen and silent (`AudioManager.isMusicActive`), so the process is
neither frozen nor killed; `MainActivity` undoes wry's `WebView.onPause()` and, with androidx.webkit's document-start
script in YouTube's frames only, keeps `document.hidden` false and swallows `visibilitychange`. Back at the root
already sends the app to the background on Android 12+ (8 to 11 still close it). Checked on the emulator: the service
runs on screen and after Home, then stops in silence; the music itself behind other apps is for the owner's phone.
Swiping the app away from the recent apps stops everything (`stopWithTask`). Still to do: play / pause / next in the
notification (a MediaSession, the Android twin of `media.rs`), Back on Android 8 to 11.

First next, the owner's test (2026-11-03, phone and PC on Beta v1.1.603): the sync between them runs, but not every setting comes
across. To do: the device sync carries every setting, except what belongs to one device (the window, start with
Windows, global keys, the update channel…: listed in one place, with a test), and the phone keeps the desktop-only
ones without showing them. Look at what `music_core::syncmode`'s snapshot takes from the settings and what the UI's
settings store applies when a snapshot arrives; compare the two devices' settings after a sync to list what's missing.

Then, in order: the phone's other texts and screens (desktop-only Settings rows shown, other strings that say PC), the
QR scanner (`tauri-plugin-barcode-scanner`, reads `legato://pair?`), secrets in Android's Keystore,
an Android download on the website. From the weekly reset (2026-11-04 08:00 Paris): the Autopilot section
above, alone (no workflows).

## Autonomous run 2026-11-02 (done)

The owner's ask (2026-11-02 morning, away from the PC, no question could be answered): the whole plan, most important
first, alone; stop at 95 % of the weekly limit, wrap up from 88 to 90 %; resume alone after each 5-hour limit; then a
report and the Beta pushed (the owner tries it, Stable later). Started at 64 % of the week, wrapped up at 84 %: 14
steps, each one commit on `platforms` with `pnpm check` green, then `/release-check`, the push to master (a Beta) and
its CI watched. The run's wake-up job is deleted. The report to the owner, in French: `docs/notes/report-2026-11-02.md`
(not committed).

Next: the owner tries the Beta (the report's list, and [plan-v2.md](plan-v2.md) › Check live), then Stable
(`promote.yml`). Left from the plan, in order: Features › Medium without a new account; Visualizer v2 › High `S` lines
(spectrum bars, sizes left, gradients); Optimisation; Low. Waiting on the owner: same loudness across sources (by ear);
the accessibility pass's screen reader test (labels, contrast and reduced motion are in place); mobile phases 2 and
later (Android SDK, NDK, JDK 17, a phone: [ideas/mobile.md](ideas/mobile.md)); the Jump List (installed app only).

Done in this run (newest last; `git log` has the hashes), none tried in the real app yet:

- Exportify's lists keep their real names (its progress bar's lines, any language), not "Cool music".
- Library health page (Settings › General, the search bar): files gone, videos that can't play, no cover, missing info.
- Release notes grouped (New, Fixed, Faster), shown as lists in What's new, headers in the user's language.
- Phone remote (Settings › Playback, off, per PC): a page this PC serves on its network (QR code, secret in the link, private addresses only): cover, title, play / pause, skip, seek, Up next. Not tried on a real phone: the Windows firewall asks once.
- Streaming overlay (Settings › Playback, off, per PC): `/overlay` on the phone remote's server for OBS's Browser Source; alone, the server listens on 127.0.0.1 only, and the overlay's routes answer this PC only (`remote::allowed`). Page checked in a browser with a faked `/state`; not tried in OBS.
- Share as a picture (the player's right-click): a card with the cover, title, artist and a lyric line, in the cover's colours or the theme's; copied for a chat or saved as PNG / JPEG (`save_picture`, `music_core::cover::export`). Esc over Now Playing now closes only the dialog on top. Checked over the demo (the save faked); a real paste not tried.
- Cover display (C, or the button beside Karaoke in Now Playing): the cover huge over its blurred copy, title and progress on it, a clock from its right-click (setting `coverClock`), the display kept awake. Checked over the demo (light, dark, 16:10, 16:9, portrait, square); not on a real second screen.
- Settings › Privacy: every host the app, its windows and plugins talked to today, and why (`music_core::netlog`: the connectors' resolver `Noted`, the WebView2 hook on every window, `shield::watch` observing sign-in windows without blocking). Checked over the demo with invented rows; the real log not seen in the running app.
- Pick up on the other PC (Sync Mode): the snapshot carries the saved session's song, position and save time (`now`); another PC where nothing plays offers it when newer than its own (a toast once, then "Resume … from …" in the idle player bar). Not tried between two real PCs.
- Mobile phase 1, the phone layout (below 640 px only: no desktop window gets it): bottom tabs, mini player, Your library tab, one-column Now Playing. Checked over the demo at 375 × 812 (`demo` in .claude/launch.json).
- The owner's new ask mid-run (2026-11-02): a mobile version, Rust reused. Spec and phases in
  [ideas/mobile.md](ideas/mobile.md); no Android SDK / NDK / JDK on this PC, so phase 1 (phone layout in `ui/`) only.
- Back to a month (Home's Your mixes, Mixes › Explore): songs played a lot in one past month, at least three months back, and hardly since (`fixation` in `crates/core` mixes; its songs leave Rediscover). Unit test; the card checked over the demo with a faked mix. Needs a few months of real history before it shows.
- Visualizer weighting (Settings › Playback, or the visualizer's right-click): as measured (default), +3 dB per octave, A-weighting, ITU-R 468. Tested against the A and 468 tables; over the demo the tilt lowers the bass third and lifts the treble third. Not judged by eye on real music.
- Visualizer colour (same places): the text colour (default), the accent, or the playing cover's hue made vivid (3:1 at least). Checked over the demo; the cover's colour on a raster picture (the demo's SVG covers average to grey).

## Autonomous run (the owner's ask, 2026-10-31 evening)

The owner left the PC running and asked for as much of the plan as possible, without stopping, resuming by itself after
the usage limits reset. The owner came back on 2026-11-01, asked for a report, then said to publish it as a Beta: the
run stopped after `fd33cbd` (its recurring wake-up job deleted), `/release-check` passed (suite, smoke test, website
build), and `platforms` went to master that day, master's empty merge `0bc7866` merged in first. GitHub's `check` then
wanted two fixes the Windows-only local check can't see: a workflow line (`5834cc4`) and an import macOS found
unused (now in `/release-check`). That evening, on the owner's word,
two fixes from the owner's report went out as the next Beta: one Liked Music (`1b84e46`) and a YouTube video that never
starts loaded again (`4a45d27`; plan › Check live). The owner saw it again on 1.1.570: its cause is Google's "Sorry…"
page answering the embed's player request while it limits this PC after an import's searches; `refused.js` and the store
now load the video again at once (`dc270a8`, a Beta that evening). Imports then got slower on purpose, so the address
isn't limited: one search at a time, 3 s apart, 5 min after a refusal (committed on `platforms`, not pushed). Next: the owner's 1.1.557 updates to it by itself (the real update
from one Beta to the next: `3f50031` took rustls and ring out of the updater), the owner tries both fixes, then the
Check live list, then Stable. The new website went out the same day, on the owner's word, before Stable. Rules the run kept, on top of `CLAUDE.md`:

- Local commits on `platforms` only, one tested step each (`pnpm check` green). No push, no PR, no merge.
- Nothing that needs a real account, a sign-in, a bulk real search or the owner's ear: those lines wait in
  [plan-v2.md](plan-v2.md) › Check live in the real app.
- No subagents, no workflows. Graph first (`graphify query`), `graphify update .` after code changes.
- Each line ticked as it lands, with what wasn't tried for real; this file says what's next.

Order: the plan's Platforms lines that need no account, then quick wins from Features › High, Optimisation and
Workflow, then milestone 4 (Lyrics).

Done in this run (newest last), none tried in the real app yet:

- `a5e5f37` A hidden import's toast names what runs (Apple Music, a shared list, the search again), not always Spotify.
- `144a6a0` A private Spotify playlist's link says Connect Spotify works, in the user's language.
- `b758ddd` Exportify's local files come in as songs to find.
- `bb2950e` Songs not found › Find this song: the version picked joins the song's own row (playlists play it).
- `7438d6f` Playlists in and out as files: M3U / M3U8 / XSPF / CSV (Add music › Import a list; a playlist's menu ›
  Save as file).
- `a190d0f` From iTunes or MusicBee: the library file's playlists ticked, then the import screen (Add music).
- `051a07a` Spotify's own data export (`Playlist1.json`, `YourLibrary.json` or its ZIP), opened from Connect Spotify.
- `da1d866` Spotify songs by paste: Ctrl+A then Ctrl+C in a list of Spotify's app, pasted in Add music › Import a list
  of songs; each song named from its public embed page, then the import screen.
- `05c57d6` A SoundCloud song link pasted anywhere: named by SoundCloud's oEmbed, found on YouTube, added. Sets said
  plainly.
- `31f0b01` Files and folders dropped from Explorer: folders watched, files kept on their own, the notice's Play.
- `5119311` Library backup and restore in one file (Settings › General).
- `821b5bf` No fade within an album (Settings › Playback, on by default): an album's songs played in a row never dip.
- `16b22f3` Start radio from an album, an artist, a playlist or a selection; every radio endless.
- `7734b5f` Pinned playlists and playlist folders in Your library.
- `78338de` Command palette: the search bar (Ctrl+K) finds pages, actions and settings too.
- `40884cd` Pause when headphones or a Bluetooth headset disconnect (Settings › Playback › Headphones and calls).
- `bfa1122` Local files follow Windows' new default output, at the same place, paused or not.
- `3a5b2e2` Smart shuffle: artists spread through the queue, songs heard in the last day last.
- `c5647d4` Daylist mix: "Your Friday evenings", this weekday's time of day, on the Mixes page.
- `cd0e783` Pause during calls (Windows' ducking notifications), off by default; plays on when the call ends.
- `87fb992` The smoke test blocks `check` (it only runs on GitHub, after a push).
- `b1a99a1` Now Playing, the lyrics panel and the dialogs load on first use: 51 kB less JS at launch.
- `91be1bd` Issue templates (bug with diagnostics, feature idea) and the website's "What's next" from the roadmap.
- `ff94cf3` Project skills for Claude Code: add a setting, add a connector, release check (`.claude/skills`).
- `42e3d4b` Cover thumbnails for WebP and GIF originals (lists no longer load them whole).
- `3f50031` Installer size: the updater's unused rustls and ring left out, 0.55 MB less to download (check a real update).
- `ac422e5` Word-by-word lyrics from LRCLIB's Lyricsfile or enhanced LRC, in the panel and Karaoke.
- `89a48f4` A local song's own lyrics (its tags, or an .lrc beside it) first: nothing sent for it.
- `ef9c2cc` Lyrics edited and saved into a local song's file (its .lrc or its tags), the fixed timing too.
- `7b9a7b4` Plain lyrics of a local song timed by tapping along, saved into its file.
- `082ad0b` Volume levelling for local files (Off / Song / Album, off by default): ReplayGain tags or measured once, to -14 LUFS.
- `cf0abda` Ratings in half stars (column, menus, Alt+1…5, Highest rated sort, smart playlist rules), synced by Sync Mode.
- `e77b4ec` Edit info of many local songs at once: album artist, genre, year, track and disc, numbered in the list's order.
- `37b6ce4` Column browser on Songs (off by default): Artists and Albums panes above the list.
- `944637b` ListenBrainz scrobbling with the user's token (Settings › Accounts): what plays now and each listen,
  waiting when offline or too fast.
- `8a7ced9` Connect Spotify in the welcome, beside YouTube Music; a dialog inside another gets the keys and the window.
- `21fe2dd` Auto-DJ from Songs or a menu: ten picks at a time by the rules in Settings › Playback.
- `23898a1` Wavy progress bar (Settings › Appearance › Player), off by default.
- `fd33cbd` Sleep timer: End of this album, and the timed fade over the last 3 minutes.

Milestone 4 (Lyrics) is done but for translation and finding a song by a line: the owner's calls, notes in
[plan-v2.md](plan-v2.md). Milestone 5's lines that need no account are done; Jellyfin / Navidrome wait for the owner's server. When work goes
on: the open lines of plan-v2 that need no account, by size (`S` first).

## Branches

| Branch | State | Next |
|---|---|---|
| `platforms` | Work goes here. On master since 2026-11-01 (a Beta). `pnpm check` green. | Carry on when the owner says so; each push to master is a new Beta. |
| `claude/site-scroll-3d-aff654` | The new website home page: merged into `platforms` and master on 2026-11-01, published. Its worktree `.claude/worktrees/laughing-golick-d0fedf` stays (about 10 GB of build output). | `git worktree remove` when the owner wants the space back: the branch is in master. |
| `master` | `platforms` as of 2026-11-01, a Beta; Stable is still v1.1.479. | The owner tries the Beta, then promotes it. Every push is a Beta, and a change in `site/` deploys the website: only on the owner's word. Stable is `promote`, by hand (`CONTRIBUTING.md` › Releasing). |

The owner keeps `platforms` and the site branch local, so a fresh clone has neither: `git branch -vv` says what is on
GitHub.

## Where Platforms stands

Done and tried on the owner's real account in the dev app:

- Connect Spotify: Exportify first, Spotify's own page second, private playlists and Liked Songs, free. Every failure ends
  in a dialog.
- An import of 21 lists and 2142 songs: lists saved first, songs the library knows not searched, an import screen.

Done, tested on simulated events, a public page or `pnpm check` only, never on a real run:

- The screen's line for the time left and its line for YouTube's limit, with the countdown.
- `searchpace::Line`, one search settling the other songs it brought back. Its gain isn't measured.
- Search again on the Songs not found page, and an import giving up after 15 minutes refused.
- Karaoke (K) no longer crashes the YouTube player (a hook skipped in `PlayerBar.tsx`, found from 1.1.479's report).
- A Legato link carries its videos named (share code version 2): no oEmbed, no search for them.
- A Google refusal during a sync stops that account in one line; YouTube Music every 15 minutes, off by default,
  offered at sign-in.
- Connect Apple Music (Apple's page read like Spotify's, against Apple's terms, said first).

Known facts for whoever tests it:

- Google refused this PC's anonymous searches on 2026-10-31: about 40 searches, a block of 5 minutes, then one every 15 s.
  The app's normal search is refused too during a block. Expect it in any test of search.
- A run was cut at 59 of 300 songs by a restart of `pnpm dev`. What it found is saved; the next import only searches the rest.

## Next

1. The owner tries what waits in [plan-v2.md](plan-v2.md) › Check live in the real app, Connect Apple Music first, and a
   real import: the `YouTube refused searches` line of `diagnostics.log` (refused and answered counts) judges `Line`. The
   real `diagnostics.log` is not the one your tools see: [development.md](../development.md) › Two dev libraries.
2. The open lines of [plan-v2.md](plan-v2.md), in the autonomous run's order above.
3. When the owner calls the milestone done: `platforms` into master, try the Beta, `promote`, then the site.

## On this PC

- `gh` signed in as the repository's owner, signing key in `~/.tauri/music-app.key` (also a GitHub secret).
- `graphify` in `~/.local/bin`. On a PC without it, skip the graph rules of `CLAUDE.md` and read the code.
- `ui/dev/`: an old preview harness, local only (`.git/info/exclude`), unused now.
- The dev app's library and sign-ins are in the true `%APPDATA%\app.legato.desktop.devbuild` and the keychain: nothing of
  them is in the repository, a new PC starts empty.
