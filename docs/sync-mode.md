# Sync Mode (phase 4.2, 2026-10-21)

Several PCs share one library without a server of ours. Rule change by the user (2026-10-16 brief): syncing through
OneDrive and the local network is allowed; everything else stays (no backend, secrets in the keychain, the interface
never reaches the network itself).

## What travels

Everything the user made, from one PC to the others:

- playlists made in the app and imported ones (name, songs, order), songs added by hand, songs removed from the
  library;
- listening history and mix preferences (Less / Never);
- Live Editor versions and presets (songs found by their ids on the other side);
- settings, key by key, except this PC's own: interface size, mini player spot and width, defaults version;
- the YouTube Music accounts picked for sync;
- the list of connected services ("Signed in there, not here", with a button to Accounts).

Never: local file paths (each PC scans its own folders; their songs are matched by title, artist and length), the
playback session, lyrics cache, updater state, WebView2 cookies (YouTube sign-in) or service tokens.

## Secrets

The brief's two options are both used, by the user's choice:

- **Protected folder** (password, recommended when asked): files sealed with ChaCha20-Poly1305 under an Argon2id key
  (19 MiB, 2 passes) from the password and the folder's salt. The Spotify app ID and the Music Detector token travel
  sealed and fill what's missing on the other PC (never replace). The key stays in each PC's keychain; the password is
  never stored. A check value in `sync.json` tells a wrong password at once.
- **Plain folder**: no secrets in the files. Other PCs show the account list and the user signs in again.
- **Local network**: always sealed end to end (SPAKE2 key from the 6-digit code), so secrets travel too.

A protected folder refuses plain files (no downgrade by someone who can write to the folder).

## OneDrive

Found from the variables OneDrive sets (`OneDriveConsumer`, `OneDrive`, `OneDriveCommercial`). Asked once (a
notice at start: "OneDrive is on this PC: sync…?", then Settings › Sync Mode): set up with or without a password.

Layout: `<folder>\Music App Sync\sync.json` (protected or not, salt, check) and one `<pc id>.musicsync` per PC
(gzip'd JSON, sealed or not). Each PC writes only its own file (temp file, then rename), so OneDrive never has to
merge one and never makes "conflict copies". Every minute (and at start, and on "Sync now"): other PCs' files that
changed are merged; this PC's file is written again only if its content changed (hash without its time), so two PCs
never ping-pong. "Another folder…" takes any folder the PCs share (another cloud folder, a NAS, a USB stick).

## Two PCs on the same network (the other way asked for)

Proposed and built: **one PC shows a 6-digit code, the other types it**; both snapshots are swapped in one session
and both PCs merge. Same machinery as playlist sharing (`connectors` `nearby`: mDNS, SPAKE2, ChaCha20-Poly1305), its
own service name and identity, 64 MB limit, 10-minute offer, 5 wrong codes and it closes.

Why this rather than an export file: both directions in one step instead of a file per direction; nothing left on a
stick or in a mail; the code seals everything, secrets included; no stale copy to import by mistake. A file still
works for those who want it: any folder (USB stick, NAS) can be the sync folder.

## Conflicts

Newest change wins, per item: a whole playlist (its `updated`), a setting key, a removed song, a preference, a Live
Editor version. Deletions are remembered (`sync_gone`: playlist, removed-then-added-back, edit, history cleared) so a
PC that missed them deletes too instead of bringing things back. Listening history is a union (one listen = song +
start time). Ties keep what's here. Clocks come from each PC (Windows keeps them in time).

First sync: the PC set up first (or the one showing the code) is the reference for settings never changed since;
joining PCs take its settings. After that, any change on any PC wins by its time.

Playlists made in the app got random ids at schema v10 (were `custom-<row id>`, which two PCs could both make).
Settings naming playlists by row id (`hiddenPlaylists`, `playlistCovers`) are translated to portable keys and back.

## Code

- `crates/core` `syncmode.rs`: snapshot, merge, sealing, manifest, OneDrive folders; `library.rs` v10 (change times,
  `sync_gone`, random custom ids, edit uids); `history.rs` (preference times, history clears remembered).
- `crates/connectors` `nearby.rs`: `sync_serve` / `sync_join`.
- `src-tauri` `syncmode.rs`: config (`sync` row: PC id, folder, asked), keychain key, minute timer, commands, events
  `sync` (merged: the UI reloads) and `sync-offer`. Snapshots read WebView2 cookies: async commands only.
- `ui/src/features/syncmode/`: `syncmode.ts` (reload on merge, the OneDrive question), `SyncSection.tsx`
  (Settings › Sync Mode).

## Tested

Unit: merge both ways, newest wins and deletions spread, removed songs / preferences / cleared history, Live Editor
versions across different row ids, settings per key with this PC's own kept, playlist keys translated, sealing and
wrong password and downgrade, OneDrive variables, network swap and wrong code. Live (2026-10-21, the user's library
of 2,944 songs): protected folder set up in 1.1 s, snapshot 287 KB sealed, a round 0.2 s; another PC's identical file
merged in 0.4 s with nothing written; a playlist made "on another PC" arrived; network sync with itself over mDNS in
3.9 s. Not tested: two real PCs through a real OneDrive account.
