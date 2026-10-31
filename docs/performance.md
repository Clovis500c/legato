# Performance

What Legato costs on a 10 000-song library: how long it takes to start, how much memory it holds and how much CPU it
uses doing nothing. `pnpm bench` measures it on the release build and adds one row to the table at the end of this
page; the website and the README quote the latest row (`BENCH` in `site/components/content.tsx`: change it with each new row). Compare rows from the same PC only.

## Running it

```bash
pnpm bench            # full run, about 20 minutes, row saved here
pnpm bench --quick    # 15 s windows and 1 minute in the tray, not saved (--save to save)
pnpm bench --skip-build --keep --note "fan noise" --shots shots
pnpm bench --visualizer --quick   # the visualizer's CPU, each look (below); never saved by the script
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

## The visualizer: `pnpm bench --visualizer`

A different run on the same data: a local song plays, and the CPU of the whole app (the same processes and window as
above) is read with the visualizer off, then with each look open, in Now Playing (the strip, or Radial's ring) and in
V's full screen, then off again; the two off windows bracket the drift of the PC. The target is under 3 % of the PC over
the off windows. It is built with the `e2e` feature (silent output: nothing reaches the speakers, so it can run at night;
its own stamp keeps it from being mistaken for the normal bench exe). The engine, the FFT worker, the page and the
render worker are all there; what is not is the audio device's own callback cost. Results are written here by hand, below.

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

## Visualizer, 2026-10-31 (Visualizer v2, step 3)

`pnpm bench --visualizer`, 60 s windows, Ryzen 5 5500 (12 threads), Windows 11 (26300), silent output, other apps
running. CPU of the whole app (its processes and its WebView2's) as % of the whole PC, a local song playing. "Extra" is
over the Now Playing controls (the page open with the visualizer off: 3.51 % before, 4.87 % after the looks, mean
4.19 %; the first run). The controls drift by about 1 point between two runs, so an extra under 1 is not a number. The
Songs page with the visualizer off reads 3.88 % (2.89 % in the second run): Now Playing itself costs about a point over
it (its 60 fps bar and backdrop, not the visualizer).

**First run, drawn at the screen's rate (60 fps), the target is under 3 %: over budget.**

| Look | Now Playing | Extra | Full screen | Extra |
|---|---|---|---|---|
| LED | 6.43 % | +2.24 | 5.79 % | +1.60 |
| Bars | 5.86 % | +1.67 | 6.35 % | +2.16 |
| Mirror | 7.61 % | +3.42 | 7.78 % | +3.59 |
| Peaks | 6.72 % | +2.52 | 3.88 % | -0.31 |
| Wave | 8.31 % | +4.12 | 7.37 % | +3.18 |
| Radial | 8.23 % | +4.04 | 6.86 % | +2.67 |
| VU needles | 8.75 % | +4.56 | 5.51 % | +1.32 |
| Spectrogram | 6.26 % | +2.07 | 5.98 % | +1.79 |

Five of the sixteen cells were over 3 points (up to +4.56, 1.5 points over). The busiest processes were the page's
renderer (the worker's drawing and the frames' arrival, 25 to 45 % of a core) and the GPU process (compositing the canvas
again each frame, 25 to 50 % of a core); the app's own process, which runs the FFT and the engine, was never among the three busiest
(the browser process, third, 3 to 6 %). The cost is the number of presented frames, so the obvious fix is to draw fewer.

**Second run, drawn at 30 fps (`VizCanvas.tsx` `FPS`; the sound's frames still come at 60), four looks:**

| Look | Now Playing | Extra | Full screen | Extra |
|---|---|---|---|---|
| LED | 5.65 % | +1.77 | 5.19 % | +1.31 |
| Radial | 4.85 % | +0.97 | 5.21 % | +1.32 |
| VU needles | 5.31 % | +1.43 | 5.78 % | +1.90 |
| Spectrogram | 5.41 % | +1.53 | 4.85 % | +0.97 |

(Controls 4.11 % and 3.66 %, mean 3.88 %; the Songs page 2.89 %.) Every cell is under 3 points, about 1 to 2, which is
12 to 24 % of a core. Bars, Mirror, Peaks and Wave were not run again at 30 fps; they draw less than LED and Radial, so
they should sit alongside, but that is not measured. Not measured either: the frame stream's own cost apart from the
drawing, YouTube (the bench is local files), a PC on battery. The 30 fps look is what the bars and the needles show
(their ballistics are time-based, not frame-based); the spectrogram's fixed 90 px/s scrolls 3 pixels a drawn frame.

## Results

First-load JS (the page's script and its preloaded chunks, `dist/index.html`), before and after lazy pages
(2026-10-31, `vite build`): 948 kB (279 kB gzip) to 829 kB (255 kB gzip). Home, Search, Add, Mixes, Stats, Smart, the
editor panel, Welcome and the YouTube shelves load on first visit. What is left is the shell, the library pages, the
player, Now Playing and the menus.

| Date | Version | PC | Window shown, cold / restart | First paint, cold / restart | RAM MB: paused / playing 1 min / tray 10 min | CPU % of the PC: paused / playing / tray | Notes |
|---|---|---|---|---|---|---|---|
| 2026-10-30 | 1.0.0 (5d8d3ae) | Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300) | 1.05 / 0.67 s | 1.47 / 0.97 s | 153 / 233 / 55 | 0.1 / 2.9 / 0.1 | other apps were running; PC load 43 / 49 / 39 % |
| 2026-10-31 | 1.0.0 (d853980) | Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300) | 0.84 / 0.84 s | 1.26 / 1.25 s | 141 / 229 / 54 | 0.1 / 2.6 / 0.1 | other apps were running; PC load 50 / 41 / 43 %; lazy pages + deferred startup (first-load JS 948 to 829 kB). The PC was as busy as for the row above, so the 0.2 s gaps between rows are within its noise: cold start improved, the restart did not (window shown, which no JS touches, moved the same way) |
