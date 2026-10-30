# Performance

What Legato costs on a 10 000-song library: how long it takes to start, how much memory it holds and how much CPU it
uses doing nothing. `pnpm bench` measures it on the release build and adds one row to the table at the end of this
page; the website quotes the latest row. Compare rows from the same PC only.

## Running it

```bash
pnpm bench            # full run, about 20 minutes, row saved here
pnpm bench --quick    # 15 s windows and 1 minute in the tray, not saved (--save to save)
pnpm bench --skip-build --keep --note "fan noise" --shots shots
```

Windows only (WebView2 and Windows' own counters), Node 22 or later, no other tool: `scripts/bench.mjs` in plain node,
`scripts/cdp.mjs` for the DevTools port. Leave the PC alone while it runs, and close what you can: other apps move
the numbers, and the row says so.

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
   suspended state. A second start follows, with the profile the first one made.

| Number | How |
|---|---|
| Window shown | Process spawn to the first visible top-level window of the process (a PowerShell watcher on the PID). |
| First paint | Process spawn to the page's `first-contentful-paint` (performance entries read over DevTools, `timeOrigin` + start time, same clock as the spawn). The window comes first: it is shown at its saved place before the page paints. |
| Cold / restart | Cold: the first launch, a new WebView2 profile, Windows scanning a new exe. Restart: the same data again. |
| RAM | Private working set (Task Manager's Details tab "Memory") of `legato-bench.exe` plus its own `msedgewebview2.exe` descendants, walked from the PID. The installed app's processes are other trees and never counted. Last sample of the window. |
| CPU | CPU time of the same processes over the window (60 s, every 5 s), as % of the whole PC, the way Task Manager shows it. Times the number of threads for % of one core. |
| PC load | Windows' own CPU load, averaged over each window, in Notes: how busy the rest of the PC was. |

## What it leaves out

- **YouTube.** The embedded player needs the network and runs in the page; a mocked one would measure the mock.
  Local files only.
- **Decoding cost.** The songs are silent WAV: cheaper to decode than MP3 or FLAC. The engine, the 60 fps progress bar
  and the page are all there; the codec is not.
- **The DevTools port.** It is open during the run (a few MB, no polling). The installed app has none.
- **Disk speed and the first run on a slow disk.** The restart start is the one users have every day.
- **GPU.** Task Manager's GPU columns are not read.

## Safety of the bench build

A release build does what a dev build does not: it checks for updates and installs them over the installed app, points
the Run entry (Open at startup) at itself and moves the old folders and keychain entries. Only the installed app,
identifier exactly `app.legato.desktop`, may (`src-tauri/src/identity.rs`: `update.rs`, `autostart.rs`, `rename.rs`).
The bench build, the dev build and any other identifier are guests. The script also refuses to start an exe that does
not carry the bench identifier, and stops only the PIDs it started.

## Results

| Date | Version | PC | Window shown, cold / restart | First paint, cold / restart | RAM MB: paused / playing 1 min / tray 10 min | CPU % of the PC: paused / playing / tray | Notes |
|---|---|---|---|---|---|---|---|
