# Sync Mode (phase 4.2, 2026-10-21)

Several PCs share one library without a server of ours. Rule change by the user (2026-10-16 brief): syncing through
OneDrive and the local network is allowed; everything else stays (no backend, secrets in the keychain, the interface
never reaches the network itself).

## What travels

Everything the user made, from one PC to the others:

- playlists made in the app and imported ones (name, songs, order), songs added by hand, songs removed from the
  library;
- listening history, mix preferences (Less / Never) and star ratings (the latest one wins, a rating taken off too);
- Live Editor versions and presets (songs found by their ids on the other side);
- settings, key by key, except this PC's own: interface size, mini player spot and width, update channel, cover cache size, phone remote, streaming overlay and its visualizer, defaults version, sidebar width, mini player place, close to tray, automatic updates, keyboard shortcuts, the welcome, reopen, microphone choices, Discord, the alarm (both PCs would ring), picture-in-picture's place;
- the YouTube Music accounts picked for sync;
- the list of connected services ("Signed in there, not here", with a button to Accounts);
- the song played last and where it stopped (2026-11-02, `now`: the saved session's current song and position, with its
  time). Another PC where nothing plays offers it when it is newer than its own: a toast once, then "Resume … from …" in
  the idle player bar; the song is this library's row when found, else played from its YouTube id. A playing song's
  position alone never rewrites the file (`hash` leaves it out unless paused): a new song or a pause does.

Never: local file paths (each PC scans its own folders; their songs are matched by title, artist and length), the
rest of the playback session (queue, shuffle, volume), lyrics cache, updater state, WebView2 cookies (YouTube sign-in) or service tokens.

## Secrets

The brief's two options are both used, by the user's choice:

- **Protected folder** (password, recommended when asked): files sealed with ChaCha20-Poly1305 under an Argon2id key
  (64 MiB, 3 passes; passwords of 10 characters or more) from the password and the folder's salt. The Spotify app ID and the Music Detector token travel
  sealed and fill what's missing on the other PC (never replace). The key stays in each PC's keychain; the password is
  never stored. A check value in `sync.json` tells a wrong password at once.
- **Plain folder**: no secrets in the files. Other PCs show the account list and the user signs in again.
- **Local network**: always sealed end to end (SPAKE2 key from the 6-digit code), so secrets travel too.

A protected folder refuses plain files (no downgrade by someone who can write to the folder).

## OneDrive

Found from the variables OneDrive sets (`OneDriveConsumer`, `OneDrive`, `OneDriveCommercial`). Asked once (a
notice at start: "OneDrive is on this PC: sync…?", then Settings › Sync Mode): set up with or without a password.

Layout: `<folder>\Legato Sync\sync.json` (a `Music App Sync` folder made before the rename is used while it's there) (protected or not, salt, check) and one `<pc id>.musicsync` per PC
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

## Your devices on the same network (v2, 2026-11-02)

The owner's ask (2026-11-02): a phone with a PC as well as two PCs, either way round, with a code or a QR code; the
devices listed with their kind and whether they are here; trusted devices that never ask for the code again; a sync
each time two of them share a network. In the interface this replaces the one-off swap above, which still answers an
older Legato's code ("Enter a code" falls back to it when no new device offers one).

- **Sync over the network** (per device, off until used): the device announces itself on the local network (mDNS
  `_legato._tcp`: its random sync id, name, system and form, a stamp; nothing else), listens on TCP 47822 (another
  port when taken) and lists the other Legato devices it hears. Off: nothing announced, nothing listening.
- **Pairing**: one device shows a 6-digit code and its QR code (`legato://pair?c=<code>&h=<ip:port>,…&i=<id>`); the
  other types the code (offers found by mDNS, flag `c=1`) or scans the QR (a phone: no mDNS needed, the addresses are
  in it). SPAKE2 from the code as before: 5 wrong codes or 10 minutes and the offer closes. Each side says whether it
  trusts the other ("Trust this device", on by default); when both do, both keep a pair key (SHA-256 of a label and the
  session key: 256 bits) in the keychain (`sync_peer_<id>`). Then the snapshots are swapped, secrets included (the
  channel is sealed).
- **Trusted devices**: later syncs need no code: SPAKE2 keyed by the pair key, its identity bound to both ids (nothing
  to guess, a fresh session key each time). "Forget" deletes the key here; the other side's next try fails and shows
  "Pair again".
- **Sync automatically** (per device, on by default): every minute, and as soon as a trusted device shows up, its stamp
  (TXT `s`: 12 hex of SHA-256 of its snapshot without its time) is compared: a sync runs when the other's stamp
  changed since the last merge, or this one's since the last send. When both sync automatically, the smaller id starts.
  Off: "Sync now" only. Every 10 minutes a sync runs anyway when a stamp can't be heard.
- **Here or not**: on this network = resolved by mDNS and not withdrawn, or reached in the last 3 minutes; else "Not on
  this network" with the last sync. The last addresses are kept per device and tried when mDNS hears nothing (Wi-Fi
  that drops multicast, Android without its multicast lock).
- **Wire**: frames of a 4-byte length and bytes. A hello in clear (1 KB at most): `{"v":2,"op":"pair"}` or
  `{"v":2,"op":"sync","from":<id>,"to":<id>}`. After the handshake every message is sealed (ChaCha20-Poly1305, a
  counter nonce per direction). The server's intro first (id, name, system, form, port, trust; 4 KB at most), then the
  client's; snapshots (64 MB at most) flow only once both intros opened, so nobody without the code gets a big buffer.
  Then an ack.
- **Only this network**: connections from private, link-local or loopback addresses (`remote::private`), 4 at a time,
  a timeout on every step.
- **Kinds**: system `windows | macos | linux | android | ios`, form `tower | laptop | desktop | phone | tablet`.
  Windows: a laptop when it has a system battery (`GetSystemPowerStatus`), else a tower. The list draws the form with
  the system's logo as a badge, and a dot with words for "on this network".
- **Never**: a pair key, a code or a snapshot in the log; nothing through the internet; a device heard but never paired
  gets nothing.

Code: `crates/core` `devices.rs` (kinds, the QR link, who starts), `crates/connectors` `devices.rs` (wire, pairing,
trusted sync, presence), `src-tauri` `devices.rs` (listener, presence, the auto timer, keychain, commands),
`ui/src/features/syncmode/Devices.tsx`.

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
  `sync_gone`, random custom ids, edit uids); `history.rs` (preference and rating times, history clears remembered).
- `crates/connectors` `nearby.rs`: `sync_serve` / `sync_join` (the one-off swap; an older Legato's code); `devices.rs`:
  the devices sync's wire and mDNS presence. `crates/core` `devices.rs`: kinds, the QR link, who starts, the rows.
- `src-tauri` `syncmode.rs`: config (`sync` row: PC id, folder, asked), keychain key, minute timer, commands, events
  `sync` (merged: the UI reloads) and `sync-pickup` (another PC's last song; `sync_pickup` for one that came
  before the interface listened). Snapshots read WebView2 cookies: async commands only. Its config row also holds the
  devices sync's switches and trusted devices.
- `src-tauri` `devices.rs`: the listener (TCP 47822), presence, the code shown, pairing, the automatic round, pair keys
  in the keychain; events `devices` (the list changed) and `device-offer` (a pairing on the side showing the code).
- `ui/src/features/syncmode/`: `syncmode.ts` (reload on merge, the OneDrive question), `pickup.ts` + pure
  `pickupOffer.ts` (pick up on another PC), `SyncSection.tsx`
  (Settings › Sync Mode), `Devices.tsx` (Your devices, Add a device) with `DeviceIcon.tsx` and pure `devicesView.ts`.

## Tested

Unit: merge both ways, newest wins and deletions spread, removed songs / preferences / ratings / cleared history, Live Editor
versions across different row ids, settings per key with this PC's own kept, playlist keys translated, sealing and
wrong password and downgrade, OneDrive variables, network swap and wrong code. Live (2026-10-21, the user's library
of 2,944 songs): protected folder set up in 1.1 s, snapshot 287 KB sealed, a round 0.2 s; another PC's identical file
merged in 0.4 s with nothing written; a playlist made "on another PC" arrived; network sync with itself over mDNS in
3.9 s. Not tested: two real PCs through a real OneDrive account.
