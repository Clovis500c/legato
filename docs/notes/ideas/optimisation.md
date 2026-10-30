# Optimisation

Measure first, then fix what the numbers show. Today known: SQLite in WAL with `synchronous = NORMAL` and a 16 MB
cache (`library.rs`), indexes on match key, track ids, added date, edits; Settings and Add-ons lazy-loaded
(`App.tsx`), locales loaded on demand (`i18n.ts`); release profile LTO + 1 codegen unit + strip; tray mode suspends the
webview (`background.rs`); levels polled only while needed (`live.ts`).

## Measure: `pnpm bench`

- **How**: a script launching the release build with the demo library scaled ×100 (10 000 songs, generated rows +
  the silent MP3s reused), reading: time to window shown and to first contentful paint (a mark sent over IPC), RAM of
  `legato.exe` + its `msedgewebview2.exe` children (Windows job / process tree), idle CPU while playing local and
  YouTube (mocked) for 60 s, RAM after 10 min in the tray. Results appended to `docs/performance.md` with the date and
  PC.
- **Effort**: M. **Done when**: numbers for the current version recorded; the website quotes them.
- **Done 2026-10-30**: `pnpm bench` (`scripts/bench.mjs`, `scripts/cdp.mjs`, `crates/core/examples/bench_data.rs`), numbers
  and method in `docs/performance.md`. First paint is read from the page's own performance entries over DevTools, not a
  mark over IPC. YouTube isn't measured (a mocked embed would measure the mock). Left: the website quotes the numbers.

## Performance budget in CI

- **How**: front-end bundle size (gzip of `ui/dist/assets/*.js`) compared to a committed budget file; fail above +10 %
  without an updated budget. Rust: startup of the core (library open + first query on 10 000 rows) as a `criterion`
  bench run in CI with a loose threshold.
- **Effort**: S-M.

## Bundle

- **How**: `rollup-plugin-visualizer` once to see the big parts; lazy-load Home, Search, Stats, Smart, Mixes, Editor,
  Theme Studio, Add music, Sync Mode, Plugins (only Settings and Add-ons are today); `lucide-react` icons imported one
  by one (check no barrel import pulls them all); date / format helpers checked.
- **Effort**: S. **Done when**: first-load JS shrinks (number before / after in performance.md).

## Re-renders

- **How**: React DevTools profiler during playback with the side panel and lyrics open: anything re-rendering at the
  progress rate besides `Progress.tsx` is a bug. Zustand selectors with shallow equality; `usePlayer` subscribers
  that read `position` only through refs.
- **Effort**: S-M. **Done when**: during steady playback only the progress, lyrics line and visualizer update.

## Library at scale

- **How**: generate 50 000 songs, run every query from the UI with `EXPLAIN QUERY PLAN`: add indexes for artist /
  album browsing, play counts (history aggregated), likes, playlist membership order. Search: FTS5 virtual table on
  title / artist / album (with `unicode61 remove_diacritics 2`, like `fold`), kept in sync by triggers. Scans:
  background with progress events (exists?) and batched inserts in one transaction per 500 files.
- **Rules**: migration with `SCHEMA_VERSION` bump.
- **Effort**: M. **Done when**: every page opens under 100 ms at 50 000 songs on the bench PC.

## Cover cache

- **How**: `src-tauri/src/art.rs` writes to a disk cache with no size limit found: cap (e.g. 500 MB, setting), LRU
  eviction by access time (touch on read), thumbnails at the sizes shown (64, 256, 600 px) generated once with
  `image` / `fast_image_resize`, served by size (`art://…?s=64`). Lists never decode full-size covers.
- **Effort**: M. **Done when**: a 10 000-song scroll decodes only 64 px images; cache stays under the cap.

## YouTube embeds

- **How**: today two embeds exist around a crossfade; check whether more stay alive (hidden previews, the watch-page
  window) and unload them when idle. Reuse one embed when crossfade is off (`loadVideoById` instead of a new iframe).
- **Effort**: S-M. **Done when**: RAM with crossfade off doesn't grow over 20 songs.

## Tray mode

- **How**: measure RAM / CPU after 10 min hidden; if the webview still holds > 150 MB, consider unloading the page
  entirely while not playing (state saved by `session.ts`, restored on open) and keeping YouTube playback impossible
  in that state (say so) or keeping only the player frame.
- **Effort**: M. **Done when**: tray RAM halved or the reason documented.

## Startup

- **How**: order of work at launch: window background (`window_bg.rs`) → library → UI; defer plugins, Sync Mode's
  first pass, Last.fm, Discord, update check, shield list loading until after first paint (a "ready" signal from the
  UI). Library open off the main thread (async command).
- **Effort**: S-M. **Done when**: first paint time improved and recorded.

## Installer size

- **How**: `cargo bloat --release --crates` on `legato.exe`; check big crates' features (tokio, reqwest, image,
  symphonia codecs, adblock: its lists compressed and loaded lazily); NSIS compression (LZMA solid) checked.
- **Effort**: S. **Done when**: installer size before / after in performance.md.
