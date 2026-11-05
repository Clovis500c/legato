## What and why

<!-- One or two sentences. Link the issue this closes, if there is one: "Closes #123". -->

## Checklist

- [ ] `pnpm check` passes (types, lint, tests, Clippy, Rust tests)
- [ ] `pnpm e2e` ran if this touches playback, the welcome, search, the library scan or start / quit
- [ ] A text the user reads goes through `shared/i18n` and is in every locale file
- [ ] A new setting bumps `DEFAULTS_VERSION` if it changes a default for everyone
- [ ] Something new that leaves the PC is in the website's privacy rows (`site/components/content.tsx`)
- [ ] No code copied from another project, and no audio downloaded, recorded or extracted from a service

By opening this pull request, I agree that my contribution may be used and published as part of Legato under its
[license](../LICENSE).
