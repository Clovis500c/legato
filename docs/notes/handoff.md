# Handoff

Where the work stands, for a session or an account with no history here. Read this, then `CLAUDE.md` (rules, map of the
code), then [plan-v2.md](plan-v2.md) (open work). Rewrite it when a branch or the next step changes.

Written 2026-11-01.

## Autonomous run (the owner's ask, 2026-10-31 evening)

The owner left the PC running and asked for as much of the plan as possible, without stopping, resuming by itself after
the usage limits reset. The owner came back on 2026-11-01, asked for a report, then said to publish it as a Beta: the
run stopped after `fd33cbd` (its recurring wake-up job deleted), `/release-check` passed (suite, smoke test, website
build), and `platforms` went to master that day, master's empty merge `0bc7866` merged in first. GitHub's `check` then
wanted two fixes the Windows-only local check can't see: a workflow line (`5834cc4`) and an import macOS found
unused (now in `/release-check`). That evening, on the owner's word,
two fixes from the owner's report went out as the next Beta: one Liked Music (`1b84e46`) and a YouTube video that never
starts loaded again (`4a45d27`; plan › Check live). Next: the owner's 1.1.557 updates to it by itself (the real update
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
