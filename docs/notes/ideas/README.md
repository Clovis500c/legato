# Ideas: detailed specs

The one-line to-do lives in [plan-v2.md](../plan-v2.md) (tick lines there). These files hold the detail behind each
line, so a session can pick one up without redoing the research (2026-10-30, against Riff and the best players).

| File | Plan section |
|---|---|
| [catch-up.md](catch-up.md) | 1. Catch up with Riff |
| [lead.md](lead.md) | 2. Beat Riff |
| [best-overall.md](best-overall.md) | 3. Best overall |
| [windows.md](windows.md) | 4. Small things on Windows |
| [visualizer.md](visualizer.md) | Visualizer v2 |
| [indie.md](indie.md) | Ideas loved in independent players |
| [last-batch.md](last-batch.md) | Last batch |
| [workflow.md](workflow.md) | Workflow |
| [optimisation.md](optimisation.md) | Optimisation |

Endpoints, quotas, licences and terms named here were written from research and memory on 2026-10-30: check each one
before building on it (CLAUDE.md: they change).

## Each idea

- **Sees**: what the listener gets, in their words.
- **How**: the approach and the modules it touches (paths from CLAUDE.md › Structure).
- **Rules**: what CLAUDE.md's non-negotiable rules ask of it (legal playback, no server of ours, privacy rows on the
  website, keychain, i18n, `async fn` for commands that lock or read).
- **Needs**: ideas or groundwork that must land first.
- **Effort**: S = one session, M = a few, L = many. **Risk**: what could sink it.
- **Done when**: the check that closes the plan line.

Every idea also carries the usual: texts through `shared/i18n` with French, a settings row in the search index when it
adds a setting (`DEFAULTS_VERSION` when defaults change), a right-click menu on new surfaces, tests next to the code,
mockito for any network, `docs/` and the website updated when users see it.

## Already there (found while writing these)

- Taskbar thumbnail buttons (previous / play / next): `src-tauri/src/thumbbar.rs`. Only the Jump List is left.
- Song radio: `features/player/radio.ts` (YouTube Music's radio when signed in, else library songs that fit).
- Sleep timer with "after this song": `features/player/sleep.ts`. Album end and a fade are left.
- Tag editing for one local file: `src-tauri/src/tags.rs`, `features/library/EditInfo.tsx`.
- Song lists pasted or from CSV / TSV: `crates/core/src/songlist.rs`.
- Smart playlist rules today: artist, album, source, plays, added (`features/smart/rules.ts`).
