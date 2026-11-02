# Legato on phones (the owner's ask, 2026-11-02)

The owner's words: a mobile version of the app, well optimised, reusing the Rust code where possible. A whole app, not a
companion: replaces "Mobile companion" in [best-overall.md](best-overall.md). Android first, iPhone after.

## What the user gets (v1, Android)

- The library, playlists, likes, history, mixes, stats, synced and word-by-word lyrics, themes, the 18 languages: the
  same app, laid out for a phone.
- Playback: YouTube in YouTube's embed while the app is on screen (the embed's terms; local files and personal servers
  play on in the background with the media notification); local files on the phone through the Rust engine and the
  Live Editor's chain.
- Sync with the PCs: Sync Mode's 6-digit code on the LAN (same `nearby` / `syncmode` code), or the shared folder
  through Android's document picker (OneDrive's provider). Imports (Spotify, Apple, files) stay on the PC and arrive by
  sync.
- Media notification and lock screen controls, headset and Bluetooth buttons, audio focus (a call pauses, a navigation
  voice ducks).
- The phone remote for the PC in the same app; Last.fm and ListenBrainz scrobbling; LRCLIB lyrics; Music Detector from
  the microphone.

## How: Tauri 2's Android target, same crates

- `src-tauri` built as a library with `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, the same React `ui/` in
  Android's System WebView (Chromium), the same IPC commands and generated types.
- Reused as they are: `crates/core` (rusqlite's bundled SQLite builds with the NDK's clang), `crates/connectors`
  (reqwest: rustls with webpki roots on Android, Windows' TLS stays on Windows), `crates/dsp`, `crates/player`
  (rodio / symphonia over cpal's AAudio backend), `crates/plugins` (QuickJS builds with the NDK), `crates/shield`'s page
  scripts.
- Desktop only, behind `#[cfg(desktop)]` (each has a phone answer or none): tray and background (`background.rs`; a
  foreground service instead), global shortcuts, the Windows media panel (`media.rs`; MediaSession instead), WASAPI
  loopback (Detector: microphone only), `unplug.rs` (audio focus and `ACTION_AUDIO_BECOMING_NOISY` instead), thumbbar,
  speech (Android's recognizer later), `window_bg.rs`, the updater (APK updates by GitHub or the store), `ytwatch.rs`
  (a video that can't embed is skipped or opened in the YouTube app), Spotify / Apple / Exportify windows (Tauri mobile
  has one WebView: imports stay on the PC).
- Secrets: `keyring` has no Android backend: `SecretStore` on Android's Keystore (a small Kotlin plugin), same trait.
- Ad and tracker blocking: WebView2's hook has no twin; Android's `shouldInterceptRequest` in the Kotlin plugin feeds the
  same `adblock` engine (phase 4).
- Interface: a phone layout below 600 px in `ui/` (also a narrow desktop window): bottom tabs (Home, Search, Library,
  Mixes), the mini player above them, Now Playing full screen (swipe down to close), one-column lists, long press = the
  right-click menus, dialogs as bottom sheets, safe areas (`env(safe-area-inset-*)`), 44 px touch targets.

## Optimised from the start

- arm64-v8a only at first (one ABI, a split APK per ABI later); release profile as desktop (LTO, one codegen unit,
  strip); budget: APK under 25 MB, cold start under 1.5 s on a mid-range phone, under 60 MB idle, nothing polling.
- The engine thread sleeps while paused; the WebView's 60 fps parts (progress, visualizer) stop when the screen is off;
  covers through the same `art` scheme and disk cache, thumbnails only in lists; SQLite in WAL as on desktop.
- `pnpm bench`'s numbers get a phone row (start, RAM, battery per hour of local playback).

## Phases (each one a Beta)

1. `S-M` Phone layout in `ui/`, by width, checked in a browser at 375 × 812 over the fake Tauri (`site/demo`).
2. `M` Portable shell: desktop-only modules behind `cfg(desktop)`, the mobile entry point, `SecretStore` on Android,
   rustls on Android; `cargo check --target aarch64-linux-android` in CI.
3. `M-L` `tauri android init`, a first APK: local files and the YouTube embed, the library from a backup file or the
   LAN code.
4. `M` MediaSession notification, audio focus, background play of local files (foreground service), ad blocking.
5. `M` Sync both ways, the phone remote, scrobbling, lyrics, Detector.
6. `M` Signed APKs on GitHub Releases (Beta and Stable like desktop); the Play Store later (its YouTube-embed policies).
7. `L` iPhone (Tauri iOS: a Mac and an Apple developer account).

## The owner's calls before phase 3

- Install the Android SDK, NDK and JDK 17 on this PC (Android Studio, about 10 GB) and the Rust targets
  (`aarch64-linux-android`, `x86_64-linux-android` for the emulator); a phone (Android 10+) or the emulator.
- GitHub only, or the Play Store too (a $25 developer account, its review of YouTube-embed apps).
- YouTube Music signed in on the phone: Google refuses sign-in inside WebViews ("disallowed_useragent"). Signed out only
  (public catalog, the library from the PC), or the PC's session carried sealed by Sync Mode (Google may end it).

## Done when

An APK on the owner's phone plays the synced library (YouTube on screen, local files in the background with the
notification) and opens in under 1.5 s.
