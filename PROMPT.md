# Music App — starting brief

> Historical brief. The stack later moved from Electron to Tauri 2 + Rust (see `CLAUDE.md`).

## Vision
Desktop app (Electron + React + TypeScript) that lets anyone connect their own music accounts
(Spotify, YouTube Music, local files, Navidrome/Jellyfin…) and get a unified library, playlists
synced between services, synced lyrics and a real customer experience. Inspiration: Liner
(tryliner/desktop) and the community YouTube Music app — we want to do better, without depending
on a private catalog or backend.

## Constraints (decided)
- **Serverless**: no backend of ours. Everything lives with the user (tokens, local SQLite library).
- **Every user connects their own accounts**. Spotify: OAuth PKCE (no client secret).
  YouTube: OAuth loopback (installed app). "Bring your key" option (guided wizard) because quotas
  are tied to the app identifier (Spotify dev mode limits user count, YouTube ~10k units/day).
- **Plugin architecture**: a `Connector` interface (auth, read playlists, search, resolve a track,
  write a playlist). One shared track model: title, artist, album, duration, ISRC, ids per source.
- **Dedup/matching by ISRC**, fallback on title+artist+duration.
- **Legal audio playback only**: official players (Spotify Web Playback SDK, embedded YouTube player),
  local files, personal servers. NO audio extraction or circumvention.
- `ytmusicapi` (unofficial) = optional isolated connector, never the foundation.
- Lyrics: LRCLIB (free), home-made synced rendering.
- **Do not copy Liner's code**: its licence is source-available non-commercial and forbids competing
  forks / reuse of algorithms. Everything is written from scratch. Ideas (UX, concept) are free.

## Stack
Electron, React 19, TypeScript, Vite, Zustand, Tailwind, SQLite (better-sqlite3), Vitest. pnpm.
Network calls from the Electron main process (no CORS). Encrypted tokens (safeStorage).

## Mission for this session
1. Read this file, propose a repo structure and a short `CLAUDE.md` (conventions, commands).
2. Initialize the project (git, pnpm, Electron + Vite + React + TS, lint, Vitest).
3. Implement the core: track model, `Connector` interface, SQLite database, ISRC matching tests.
4. First connector: Spotify (PKCE, reading playlists). Validate it on a real account before going further.
5. Second connector: YouTube (playlist import + matching to Spotify).
6. Minimal screen: account connection, unified library list, sync button.
Ship in small commits. Only move to the next step once the previous one is tested.
Check current API quotas/rules before freezing them (they change).

## Out of scope for now
WebGL visuals, full player, mobile, background sync backend, monetization.
