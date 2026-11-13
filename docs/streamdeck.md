# Stream Deck plugin

`integrations/streamdeck/app.legato.deck.sdPlugin`: four keys for an Elgato Stream Deck (software 6.9 or later, Windows):
Play / pause, Next track, Previous track and Now playing (the title and artist on the key, refreshed every 1.5 s; pressing
it plays or pauses).

It talks to Legato's phone remote (`src-tauri/src/remote.rs`, routes in `music_core::remote`), nothing else: `POST /key?k=toggle|next|previous`
and `GET /state`, with the link's secret. The link is accepted only when its address is private (this PC, 10.x, 172.16-31.x,
192.168.x, 169.254.x) and plain `http://`; the plugin never reaches the internet and no new host is added to the website's
privacy rows.

## Use

1. Legato › Settings › Playback › Phone remote: turn it on and copy the link it shows (`http://…:47821/?t=…`).
2. Copy the `app.legato.deck.sdPlugin` folder into `%APPDATA%\Elgato\StreamDeck\Plugins\`, restart the Stream Deck software.
3. Drag a Legato key onto the deck and paste the link in its inspector (one link serves every key).

A key that cannot reach Legato (off, wrong link, the remote switched off) shows the Stream Deck's alert mark.

## Files

- `logic.mjs`: pure functions (link parsing and the private-address rule, the request each key sends, the Now playing
  face). Tested by `logic.test.mjs`: `pnpm streamdeck` (also part of `pnpm check`).
- `plugin.mjs`: the Stream Deck protocol over Node's own `WebSocket` and `fetch` (Stream Deck's Node 24), no dependency.
- `ui/link.html`: the inspector where the link is pasted (kept in the Stream Deck's global settings, on this PC).

## Not done

- **Like**: the phone remote has no like route; a key for it needs a new route and an event in the interface.
- **Not tried on a real Stream Deck**: the manifest, the protocol messages and the Node version are from Elgato's SDK
  documentation, never loaded by the software here. Tests cover the logic only.
