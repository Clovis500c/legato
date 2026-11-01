---
name: add-setting
description: Recipe for adding a user setting to Legato (a toggle, a choice or a value in Settings), every place it must land so the tests, Sync Mode and the settings search stay right. Use when a change adds, renames or re-defaults a setting.
---

# Add a setting

A setting is one key of the interface's settings object (saved in the library as the JSON setting `ui` by
`save_settings`, carried by Sync Mode). Every step below is checked by a test or by the next session; skip none.

1. **Schema**: `ui/src/shared/theme/theme.ts`.
   - The field in `interface Settings`, with a one-line `/** */` comment (what it does, its default's reason).
   - Its default in `DEFAULTS`.
   - Its line in `sanitize` (a saved file can hold anything): `typeof r.x === 'boolean' ? r.x : DEFAULTS.x`, `pick(...)` for
     a choice, a clamp for a number.
   - A **new** key needs no migration. **Changing the default** of a key users already have: bump `DEFAULTS_VERSION` and
     add the change to its migration, so saved settings get it once.
2. **Who reads it**.
   - Interface code: `useSettings((s) => s.settings.x)`.
   - The player store (`features/player/store.ts`) must not import `app/settings` (tests import the store, and
     `app/settings` touches `window` at load): push the value in from `app/settings.ts`'s `usePlayer.setState({...})`.
   - Rust needs it while the interface is busy or absent (startup, tray, updates): read the saved object,
     `state.lib().setting("ui")` then `.get("x")`, with `DEFAULTS`' value when it is missing or of the wrong type, and
     a test for both (`update.rs` › `Channel::from_ui`). Otherwise pass it as a command argument.
3. **The row**: `ui/src/features/settings/SettingsView.tsx` (or the section file it lives in), in the right group:
   `<Row setting="x" label={msg('English label')} sub={tr('What it does, in one sentence')}>` with its control.
   The label is the row's id, English, in `data-setting` (shown translated); `setting` (the key) gives the row its Reset
   chip and "Back to the default".
4. **Settings search**: `ui/src/features/settings/search.ts` › `SETTINGS_INDEX`, one entry:
   `{ section, label: msg('English label'), keywords: msg('words people would type') }`. The label must be the row's
   label exactly: a hit scrolls to `[data-setting="<label>"]`, and labels are unique per section (`search.test.ts`).
   Keep keywords from matching words other rows' tests look for ("resume", "shuffle"…).
5. **Translations**: every new English text in the 17 locale files (`ui/src/shared/i18n/locales/<lang>.ts`, keyed by the
   English text), including the keywords string. `i18n.test.ts` fails on a text missing from one or no longer used: drop
   renamed keys everywhere. French says `vous`, a regular space before `:`.
6. **Per PC or synced**: Sync Mode carries every key except `LOCAL_SETTINGS` in `crates/core/src/syncmode.rs` (zoom,
   mini player spot and width, update channel…). A setting about this PC's hardware or window belongs there; add it to
   the list and to `docs/sync-mode.md`.
7. **Bug reports**: a setting that changes how the app plays, updates or shows itself goes into `SETTINGS` in
   `crates/core/src/diag.rs` (plain values only, never a name or a path).
8. **Docs**: the feature's doc (`docs/playback.md`…), plan-v2's line ticked, and the website
   (`site/components/content.tsx`) when users would look for it; its privacy rows when the setting makes the app send
   something.
9. `pnpm check`, then one commit.
