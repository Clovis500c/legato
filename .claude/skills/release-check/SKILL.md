---
name: release-check
description: Checks a branch before the owner pushes it to master (every green push to master is a Beta release and can deploy the website) or promotes a beta to Stable. Use when the owner asks whether something is ready to push, release or promote, or types /release-check. It only reads and runs local checks; it never pushes, merges or promotes.
---

# Release check

A push to `master` that passes `check` becomes a Beta prerelease on its own (`release.yml`); `site/` changes deploy the
website (`pages.yml`); Stable is promoted by hand (Actions › promote). So the check happens before the push. Pushing,
merging and promoting are the owner's, said in the session: report, don't do them.

Run each step and report it in one line, in French for the owner, with what failed and why.

1. **Where things stand**: `git status` (nothing uncommitted that should go), the branch, and what would go out:
   `git log --oneline origin/master..HEAD`. A branch other than `master` is merged by the owner.
2. **The suite**: `pnpm check` green (types written and committed: `git status` clean after it,
   `ui/src/shared/generated` included). Long: run it in the background.
3. **The smoke test**: `pnpm e2e` when the commits touch playback, the welcome, search, the library scan, or how the app
   starts and ends (`docs/development.md`). It blocks `check` on GitHub since 2026-11-01, so a failure here holds the
   beta back.
4. **What users will read**: `node scripts/release.mjs --dry-run` prints the next version and the update card's notes
   (the `feat` / `fix` / `perf` subjects since the last `v*` tag, 20 at most). Each should make sense to a listener; a
   commit that shouldn't release at all says `[skip release]` in its first line.
5. **Version**: `MAJOR.MINOR` alike in `src-tauri/tauri.conf.json`, `package.json` and the workspace `Cargo.toml`
   (the patch number is CI's). The updater's Stable URL in `tauri.conf.json` stays
   `releases/latest/download/latest.json`: installed versions read it.
6. **Side effects**: anything new that a release build does on the PC outside the app's own folders (the Run key,
   folders, keychain moves, updates) sits behind `identity::installed()` (`src-tauri/src/identity.rs`).
7. **Privacy**: if the commits make the app reach a new host or send something new, the website's rows
   (`site/components/content.tsx` › `PRIVACY`, `SERVICES`) say so. With `site/` changed: `pnpm build` in `site/` passes.
8. **Docs**: `docs/notes/plan-v2.md` ticked for what landed, `docs/notes/handoff.md` current; the "Check live in the real
   app" lines name what was never tried for real, so the owner knows what a beta brings untested.
9. **Promoting a beta to Stable**: `node scripts/promote.mjs --dry-run` (needs `gh` signed in) shows which version and
   which notes; the betas since the last Stable should have run a while on the owner's PCs.

End with: ready or not, the blocking items first, then what stays untested.
