# Listening rooms

One device leads a room; friends on the same network follow what plays there. Each listener plays the song from their
own source (their library, YouTube, their Spotify): no sound ever travels, only the song's description, where it is
and whether it plays. The local network only: no server, no relay, nothing through the internet. The internet half
is the owner's call, not built (`docs/notes/plan-v2.md` › Waiting on the user).

| Part | Where |
| --- | --- |
| Rules: messages, checks, clock, drift, code, link, mDNS words | `crates/core/src/rooms.rs` (`music_core::rooms`) |
| The wire: handshake, sealed frames, host and listener tasks, mDNS | `crates/connectors/src/rooms.rs` |
| Shell: commands, events, the listener's search | `src-tauri/src/rooms.rs` |
| Interface: the room's view, the pill, reactions, the follow | `ui/src/features/rooms/` |
| What a listener's player does (pure, tested) | `ui/src/features/rooms/roomFollow.ts` |

## A room

- Start a room (the player's More › Listen together…, or a playlist's Share panel): the room is named after this
  device (`devices` name), gets a random 16-hex id and a 6-digit code, listens on TCP 47823 (another port when taken)
  and is announced on mDNS as `_legatoroom._tcp.local.` with its id, host name, how many listen and whether it's full.
- Join: the list of rooms heard (3 s of mDNS, private IPv4 addresses only), one picked, then its code; or the QR code
  (`legato://room?c=<code>&h=<address:port>&r=<id>`, private IPv4 only). The QR holds the code: whoever sees it can
  join.
- At most 8 listeners. 5 wrong codes and the room takes a new code (the host's view shows it), and joins shut 30 s,
  doubled at each new code up to 15 min (`rooms::shut_ms`: a new code alone left guesses unlimited; a join then hears
  "wait a few minutes"). 4 handshakes at a time;
  members don't count.
- A listener silent 15 s (3 ticks) is dropped; a host silent 15 s (asleep, off the network) is gone for its
  listeners. Every connection's task stops with the room. The host ending the room, or closing the app, ends it for
  everyone ("The room ended" / "The room's host left").

## The wire

1. The listener sends the room version in clear (`rooms::VERSION`); the host answers one byte: go, full, or another
   version ("This room runs another version of Legato").
2. SPAKE2 (Ed25519 group, symmetric, identity `legato-room-v1`) on the code, one per listener: a wrong code gives
   another key, so the first sealed frame fails and the host counts a try. The session key is
   SHA-256("legato-room-session-v1" ‖ SPAKE2 key).
3. Then ChaCha20-Poly1305 frames both ways, a length prefix checked against 16 KB before anything is read, a nonce made
   of who sends and a counter (a frame replayed or reordered fails).

Every text from the other side goes through `RoomSong::checked`: control characters out, 200 characters at most, ids
validated, a song with a path-like title refused, a cover kept only when https on a host the `art` scheme allows.

## Messages

Host to listener (`ToListener`): Welcome (room, host, people, now, next), Now (song, position, playing, the host's time,
a sequence bumped on a new song or a seek), Next (Up next's first 3 songs), Tick (position every 5 s), Pong (for the
clock), React (who, which), People, End.

Listener to host (`ToHost`): Hello (their device name), Ping (every 5 s, 3 quick ones at first), React (one per 0.4 s
at most), Leave.

Reactions are a fixed set of six (heart, fire, laugh, clap, party, wow); no free text travels.

## Following

- Clock: the median offset of the last 7 ping round trips under 3 s. The listener keeps the room's `Now` on the host's
  clock and turns it into its own when it looks.
- Once a second `roomFollow.ts` compares the room with the player: a new song → load it at the room's position; off by
  more than 1.5 s → seek, but not in the 4 s after a load or a seek (buffering), nor at the room song's end (its
  place stops at the host's length); play / pause as the host. The host sends its place again when its player slips
  by more than 1 s (buffering), a seek past 2.5 s.
- The song: the listener's library first (`Library::find`: source id, then ISRC, then title + artist + duration), then
  its YouTube id, then a version already known, then one search through the room's own `searchpace::Pace` (one at a
  time, a refusal waits 5 minutes; never routed around). Not found: "Can't find this song here", the player pauses and
  the room goes on; the next song tries again. Up next is looked for ahead, without a search unless the pace allows it;
  a song already being looked for waits for that answer (never two searches for one song).
- A listener may pause on their own (no seek or play forced while paused); Catch up plays, then seeks to the room as
  soon as it plays. Skip, seek,
  queue and play-now say "You follow the room: the host picks the songs", with Leave. A song that ends waits for the
  host instead of playing the listener's own Up next.

## Privacy

What leaves the host, to the devices in the room only, sealed: the song (title, artist, album, length, ISRC, YouTube
and Spotify ids, an https cover address), its position, Up next's first 3, the device names in the room, reactions.
On mDNS, in clear, to the network: the room's id, the host device's name, how many listen, full or not. Never a file
path, an account, a token or sound. The website's privacy row "Listening rooms" says the same; change both together.

## Tests

- `music_core::rooms`: messages both ways, the checks, the clock, the drift rule, the link, the mDNS words.
- `music_connectors::rooms`, over 127.0.0.1: two listeners following one song, a wrong code refused and too many
  changing it and shutting joins, a full room, the end heard, a host gone without a word, a host gone quiet, no task
  left reading once the room went, another version told before the code, a big
  frame before the code never read.
- `roomFollow.test.ts`: load, seek, play / pause, the quiet time, an own pause and Catch up, a missing song, a song
  ended here first, no seek back at the end, a host's seek while paused.
- The interface in the site demo (an invented room to start or join). Two real devices: plan-v2 › Check live.
