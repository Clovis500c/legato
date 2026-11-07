---
name: add-connector
description: Recipe for adding a service connector to Legato (a new site or API the app talks to, a pasted link kind, a lyrics or metadata source), from the Rust module and its mock tests to the privacy row on the website. Use when a change makes the app reach a new host.
---

# Add a connector

The app has no server: each service is reached from Rust, on the user's PC, and the website says what goes where.
Before writing anything, read the service's terms and current API docs (endpoints and quotas change: Spotify renamed
`/tracks` to `/items` in February 2026), and check it fits `CLAUDE.md`'s rules: legal playback only (never download,
record or export a platform's audio), no keys of ours, a refusal (429, "Sorry…") is never routed around.

1. **Module**: `crates/connectors/src/<name>.rs`, `pub mod <name>;` in `crates/connectors/src/lib.rs`.
   - `//!` header: what it reads, with what (public API, oEmbed, the user's own key), what it never does.
   - Base URLs as `pub const`, injectable for tests (`with_urls(...)`, like `lrclib.rs`); `REQUEST_TIMEOUT` from
     `linklist.rs` on every request.
   - Pure parsing (link patterns, JSON to `Track`) in plain functions, tested on their own.
   - Errors the user may see: English sentences from Rust (`bail!("This … doesn't exist")`), mapped to translated text in
     `ui/src/shared/errors.ts` (`KINDS`, one regex each, the text through `msg`).
2. **Tests** in the module (`#[cfg(test)]`): `mockito::Server::new_async()` for every request, the real answer's shape
   saved as a fixture string. Never the real network. Cover: the happy path, a 404 / private item, a 429, a malformed body.
3. **Shell**: commands in a feature file of `src-tauri/src` (`links.rs`, `lastfm.rs`…), not in `lib.rs`; registered in
   `lib.rs`'s `generate_handler!`. `async fn` when it reaches the network, locks the library or reads files (a sync
   command freezes the window).
   - Hosts the smoke test could reach (search, lyrics, pasted links): a field in `src-tauri/src/hosts.rs`, so the
     `e2e` build sends them to its mock and a normal build keeps the real host fixed at compile time.
   - Secrets (a user's key, a session): the keychain (`SecretStore`, `src-tauri/src/secrets.rs`), never the settings or
     a log line.
   - Searches on YouTube for an import go through `music_core::searchpace` (backs off from a refusal).
4. **Types and calls**: structs that cross IPC get `#[derive(ts_rs::TS)]` + `#[ts(export)]`; `pnpm types` writes
   `ui/src/shared/generated` (commit it). One wrapper per command in `ui/src/shared/api.ts`:
   `name: (args) => invoke<T>('command', { args })`; nothing else calls `invoke`.
5. **Pictures**: covers from a new host need it in `crates/connectors/src/art.rs`'s allowlist (exact names) with a good
   and a bad test URL; the interface shows them through `shared/art.ts` (`remoteArt`), never an `https:` URL (the CSP
   has none).
6. **Interface**: texts through `tr` / `msg` in all 17 locales (`i18n.test.ts`); a service icon in
   `shared/ui/SourceIcon.tsx` if songs carry it; the welcome's ways in (`features/welcome`) if it brings music in.
7. **Privacy and docs**:
   - The website's rows (`site/components/content.tsx` › `PRIVACY`, `SERVICES`): which host, when, what is sent, what
     needs an account. A row that is no longer true is a bug.
   - `docs/architecture.md` if it changes how things flow; plan-v2's line ticked, with what wasn't tried for real.
8. `pnpm check` (and `pnpm e2e` if the smoke test's path changed), then one commit. Trying it against the real service
   is the owner's call: no bulk real requests from a script, no real account driven by Claude.
