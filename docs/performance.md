# Performance

What Legato costs on a 10 000-song library: how long it takes to start, how much memory it holds and how much CPU it
uses doing nothing. `pnpm bench` measures it on the release build and adds one row to the table at the end of this
page; the website and the README quote the latest row (`BENCH` in `site/components/content.tsx`: change it with each new row). Compare rows from the same PC only.

## Running it

```bash
pnpm bench            # full run, about 20 minutes, row saved here
pnpm bench --quick    # 15 s windows and 1 minute in the tray, not saved (--save to save)
pnpm bench --skip-build --keep --note "fan noise" --shots shots
```

Windows only (WebView2 and Windows' own counters), Node 22 or later, no other tool to measure: `scripts/bench.mjs` in
plain node, `scripts/cdp.mjs` for the DevTools port. The build is the release profile, which stops without the
third-party notices: run `pnpm notices` once on a fresh clone (needs cargo-about, `docs/licenses.md`; `pnpm build` leaves
them too). The bench looks for them first and says so, instead of failing minutes into the build. Leave the PC alone
while it runs, and close what you can: other apps move the numbers, and the row says so.

## What it does

1. **Build**: `tauri build --no-bundle` with `src-tauri/tauri.bench.conf.json` (identifier `app.legato.desktop.bench`):
   the release profile, no installer, no signing. The exe is copied to `target/bench/legato-bench.exe`, a folder only
   the script writes, so what runs there is never a normal build. `--skip-build` keeps it while the build inputs
   (`src-tauri`, `crates`, `ui`, the lock files) are unchanged.
2. **Data**: `crates/core/examples/bench_data.rs` writes a fresh `%APPDATA%\app.legato.desktop.bench` through
   `music_core::Library`, the way the app does: 10 000 local songs (hard links to 16 silent WAV files of 20 to 27 s,
   the library keys a local song by its path), 12 playlists of 200 to 640 songs, 3 000 plays. The script deletes only
   that folder and `%LOCALAPPDATA%\app.legato.desktop.bench` (the WebView2 profile), never any other.
3. **Run**: the app starts with the DevTools port open (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, next to
   `background::BROWSER_ARGS`), English interface. On the Songs page it stays paused, then plays the first song
   (the queue goes on through the library) for a minute, then is paused and closed to the tray (close = hide) for
   10 minutes. The app suspends its page after 5 minutes hidden and silent (`background.rs`), so the last number is the
   suspended state. A second start follows, with the profile the first one made. The OneDrive suggestion toast (any PC
   with OneDrive) is dismissed first, as a user's settled session would have it, and the PC and the screen are kept awake
   while the script runs (a media player's request, gone with the script).

| Number | How |
|---|---|
| Window shown | Process spawn to the app's main window (window class `Tauri Window`) being visible: a PowerShell watcher on the PID. Not `MainWindowHandle`: the single-instance plugin's window is visible from the start. |
| First paint | Process spawn to the page's `first-contentful-paint` (performance entries read over DevTools, `timeOrigin` + start time, same clock as the spawn). The window comes first: it is shown at its saved place before the page paints. |
| Cold / restart | Cold: the first launch on a new data folder and a new WebView2 profile. Restart: the same data again, after the first run was stopped. |
| RAM | Private working set (Task Manager's Details tab "Memory") of `legato-bench.exe` plus its own `msedgewebview2.exe` descendants, walked from the PID. The installed app's processes are other trees and never counted. Last sample of the window. |
| CPU | CPU time of the same processes over the window (60 s, sampled every 10 s), as % of the whole PC, the way Task Manager shows it. Times the number of threads for % of one core. The busiest processes of each window are printed with their WebView2 kind (renderer, gpu-process...). |
| PC load | Windows' own CPU load (`Win32_Processor.LoadPercentage`), averaged over each window, in Notes: how busy the rest of the PC was. The samples themselves cost WMI a second of CPU each, inside that number. |

## What it leaves out

- **YouTube.** The embedded player needs the network and runs in the page; a mocked one would measure the mock.
  Local files only.
- **Decoding cost.** The songs are silent WAV: cheaper to decode than MP3 or FLAC. The engine, the 60 fps progress bar
  and the page are all there; the codec is not.
- **The DevTools port.** It is open during the run; the installed app has none.
- **Disk speed and the first run on a slow disk.** The restart start is the one users have every day.
- **GPU.** Task Manager's GPU columns are not read.

## Safety of the bench build

A release build does what a dev build does not: it checks for updates and installs them over the installed app, points
the Run entry (Open at startup) at itself and moves the old folders and keychain entries. Only the installed app,
identifier exactly `app.legato.desktop`, may (`src-tauri/src/identity.rs`: `update.rs`, `autostart.rs`, `rename.rs`).
The bench build, the dev build and any other identifier are guests. The script also refuses to start an exe that does
not carry the bench identifier, deletes only the two bench folders, and stops only the PIDs it started (checking the
image name first). The first run was checked against the HKCU Run value and its Task Manager switch, the installed
`legato.exe` and the folders under `%APPDATA%` and `%LOCALAPPDATA%`: nothing changed.

## First run, 2026-10-30

Version 1.0.0 on a PC that was busy (OneDrive syncing, other apps: PC load 39 to 49 %), so read the shape, not the last
digit. Quick runs the same evening moved by about a third on the CPU while playing.

- **Start.** The window is up in 1.05 s cold (0.67 s the next time) and the page has painted at 1.47 s (0.97 s). The
  window shows first, at its saved place, before the page has anything to draw.
- **RAM.** 153 MB paused: the app 22 MB, WebView2 131 MB over 7 processes in all. 233 MB playing: the growth is in
  WebView2 (208 MB), the app stays at 25 MB. In the tray, silent: 131 MB after 1 minute and 129 MB after 4, then 54 MB
  after 6, once the page is suspended (5 minutes hidden and silent, `background.rs`), and 55 MB at 10 minutes. The
  150 MB mark of the Tray mode idea (`docs/notes/ideas/optimisation.md`) is crossed only before the suspend.
- **CPU.** Paused on screen 0.8 % of a core. Playing a silent WAV 34 % of a core, nearly all of it in the page's
  processes: the renderer 21 %, the GPU process 12 %, the app itself 1 %. In the tray, suspended, 1.0 % of a core, all of
  it the app process and none of the page.

These feed the Optimisation items of `docs/notes/plan-v2.md` (re-renders at 60 fps, tray mode).

## Lazy pages and deferred start: before and after, 2026-10-31

The two rows below disagree on the restart (first paint 0.97 s, then 1.25 s), with the PC at 41 to 50 % load. So three quick
runs of each build, the same night, one after the other (d30bb75 before, 0133324 after, PC load 15 to 45 %). Medians:

| | Window shown, cold / restart | First paint, cold / restart |
|---|---|---|
| Before | 0.71 / 0.57 s | 1.16 / 0.88 s |
| After | 0.61 / 0.55 s | 1.04 / 0.81 s |

No regression: the restart's first paint gains about 0.07 s and the cold one about 0.1 s; the window, which has no JS in it,
does not move. The gap in the table was the PC's load. The first run after each build is the slow one of its three.

## Results

First-load JS (the page's script and its preloaded chunks, `dist/index.html`), before and after lazy pages
(2026-10-31, `vite build`): 948 kB (279 kB gzip) to 829 kB (255 kB gzip). Home, Search, Add, Mixes, Stats, Smart, the
editor panel, Welcome and the YouTube shelves load on first visit. What is left is the shell, the library pages, the
player, Now Playing and the menus.

| Date | Version | PC | Window shown, cold / restart | First paint, cold / restart | RAM MB: paused / playing 1 min / tray 10 min | CPU % of the PC: paused / playing / tray | Notes |
|---|---|---|---|---|---|---|---|
| 2026-10-30 | 1.0.0 (5d8d3ae) | Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300) | 1.05 / 0.67 s | 1.47 / 0.97 s | 153 / 233 / 55 | 0.1 / 2.9 / 0.1 | other apps were running; PC load 43 / 49 / 39 % |
| 2026-10-31 | 1.0.0 (d853980) | Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300) | 0.84 / 0.84 s | 1.26 / 1.25 s | 141 / 229 / 54 | 0.1 / 2.6 / 0.1 | other apps were running; PC load 50 / 41 / 43 %; lazy pages + deferred startup (first-load JS 948 to 829 kB). The PC was as busy as for the row above, so the 0.2 s gaps between rows are within its noise: cold start improved, the restart did not (window shown, which no JS touches, moved the same way) |
