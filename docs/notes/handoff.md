# Handoff

Where the work stands, for a session or an account with no history here. Read this, then `CLAUDE.md` (rules, map of the
code), then [plan-v2.md](plan-v2.md) (open work). Rewrite it when a branch or the next step changes.

Written 2026-10-31.

## Branches

| Branch | State | Next |
|---|---|---|
| `platforms` | Work goes here: milestone 3 (Platforms) so far, on top of `11a69c9`. `pnpm check` green. | Carry on. It merges into master as it is: master's one commit past `11a69c9` is an empty merge. |
| `claude/site-scroll-3d-aff654` | The new website home page, finished, in the worktree `.claude/worktrees/laughing-golick-d0fedf` (clean, about 10 GB of build output). | Waits for `platforms`: [plan-v2.md](plan-v2.md) › Website has the order. Its docs land with it (`CONTRIBUTING.md` › Website, `docs/design.md` › Website). `git worktree remove` is safe: the branch keeps everything. |
| `master` | `0bc7866`, Stable v1.1.479. | Every push is a Beta, and a change in `site/` deploys the website: only on the owner's word. Stable is `promote`, by hand (`CONTRIBUTING.md` › Releasing). |

The owner keeps `platforms` and the site branch local, so a fresh clone has neither: `git branch -vv` says what is on
GitHub.

## Where Platforms stands

Done and tried on the owner's real account in the dev app:

- Connect Spotify: Exportify first, Spotify's own page second, private playlists and Liked Songs, free. Every failure ends
  in a dialog.
- An import of 21 lists and 2142 songs: lists saved first, songs the library knows not searched, an import screen.

Done, tested on simulated events and `pnpm check` only, never on a real run:

- The screen's line for the time left and its line for YouTube's limit, with the countdown.
- `searchpace::Line`, one search settling the other songs it brought back. Its gain isn't measured.
- Search again on the Songs not found page, and an import giving up after 15 minutes refused.

Known facts for whoever tests it:

- Google refused this PC's anonymous searches on 2026-10-31: about 40 searches, a block of 5 minutes, then one every 15 s.
  The app's normal search is refused too during a block. Expect it in any test of search.
- A run was cut at 59 of 300 songs by a restart of `pnpm dev`. What it found is saved; the next import only searches the rest.

## Next

1. The owner runs a real import on the current code. Read the `YouTube refused searches` line of `diagnostics.log` (it
   gives refused and answered counts) to judge `Line`, then update the plan's lines. The real `diagnostics.log` is not the
   one your tools see: [development.md](../development.md) › Two dev libraries.
2. The open lines of [plan-v2.md](plan-v2.md) › Platforms, top down.
3. When the owner calls the milestone done: `platforms` into master, try the Beta, `promote`, then the site.

## On this PC

- `gh` signed in as the repository's owner, signing key in `~/.tauri/music-app.key` (also a GitHub secret).
- `graphify` in `~/.local/bin`. On a PC without it, skip the graph rules of `CLAUDE.md` and read the code.
- `ui/dev/`: an old preview harness, local only (`.git/info/exclude`), unused now.
- The dev app's library and sign-ins are in the true `%APPDATA%\app.legato.desktop.devbuild` and the keychain: nothing of
  them is in the repository, a new PC starts empty.
