# v2 handoff (2026-10-29)

Everything a new session needs to carry on the redesign (version 1.0, branch `v2`). Read this, then
`docs/design.md` (the direction) and `docs/notes/plan-v2.md` (open work, tick lines as they land).

## Where it stands

- Branch `v2`, about 40 commits on top of `master` (81e5213). Nothing pushed, nothing merged. Every push to `master` is a
  release (`v1.0.<commits>` now): merge and push only when the user says so.
- Done and checked in the app (light and dark):
  - Theme: Modern / Modern Dark carry the v2 palettes (`ui/src/shared/theme/theme.ts`), sky blue `#7CB8FF` = playback
    only. Defaults v8 (`v8()` in theme.ts): theme accent instead of the Windows one, compact rows (covers on them, the
    user's pick over the mockup), square covers, flat Now Playing, Now Playing without a panel. v8 isn't released: add new default changes to `v8()`,
    don't make a v9.
  - Shell (`ui/src/app/App.tsx`): window grey (`bg-recess`) behind rounded panels; top bar keeps logo, search, Add-ons,
    Settings, window buttons (the window needs it to drag; the mockup has the search in the page).
  - Sidebar (`features/sidebar/Sidebar.tsx`): nav panel, Your library panel (kind chips, covers, virtualized).
  - Right panel (`features/player/SidePanel.tsx`, setting `sidePanel`): Up next or lyrics beside every page.
  - Player bar: like, lyrics and Up next buttons, plain transport.
  - Song rows (`features/library/TrackTable.tsx`): Artist column in compact, heart on the row, grey selection, sky blue
    playing mark, Title / Artist / Album share the width 2:1:1.
  - Page headers (`shared/ui/PageHeader.tsx`): Display L titles; album, artist and playlist pages get a band in the
    cover's tint (`features/player/coverTint.ts`).
  - Now Playing (`features/player/NowPlaying.tsx`): cover or video left, title, artist, album, source and next song
    right, controls across the bottom; lyrics / Up next / Sound icons open a panel in the details' place.
  - Queue (`features/player/queue.ts`, `store.ts`, `UpNext.tsx`): Up next in three blocks; Add to queue lands after the
    songs already queued, before the rest of the list; kept through shuffle (`keepQueued`).
  - Version 1.0 (after the 0.1 releases; tauri.conf.json, package.json, workspace Cargo.toml and the `music-*` path dependencies).
  - Home (`features/home/HomeView.tsx`): no page title; chips, then shortcut tiles (Songs + 5 lists opened lately,
    `JUMP` in `recentLists.ts`, 3 × 2 or 2 columns by container query), sections with title, line under, Show all.
  - Shared section head and cards: `shared/ui/Section.tsx` (`Section`, `CardRow`, `MediaCard`: 200 px card, 176 px
    cover, grey on hover, sky blue play button). Used by Home, Mixes, Search and the artist pages' YouTube shelves.
  - Search (`features/search/SearchView.tsx`): no page title; chips All / Your library / YouTube Music / YouTube /
    Apple Music (a catalog chip hides the library's matches), Top result card, 56 px rows (`ResultRow`), type views
    behind each section's Show all with a back arrow; Spotify and YouTube Music sign-in on a line at the bottom.
  - Session (`features/player/session.ts`): `added` saved with the order and restored with it only; a queue edit
    saves 0.6 s later.
  - Mini player on top of the right panel by default (`miniPlace` 'panel', `SidePanel.tsx`): the sidebar holds the
    library only; YouTube's video shows there even with the panel hidden.
  - Motion (design.md › Shape, icons, motion): `shared/motion.ts` `pop()` on like and toggles, `.stagger`,
    `.slide-in`, `.swap-in`, `.icon-in`, `.nudge-l/-r`, `.turn` in `ui/src/styles.css`.
  - Website: `site/` (Next.js 16 static export, Tailwind 4, Motion), deployed by `.github/workflows/pages.yml` from
    master (GitHub Pages on since 2026-10-29, source GitHub Actions: https://clovis500c.github.io/music-app/). It replaces the user
    docs (README features, privacy.md); copy in `site/components/content.tsx`, pictures exported from Figma's
    landing page (node 11:8927 light, 11:10438 dark). Name and icon: Legato and the L on the playback blue (Figma, 01
    Brand, node 11:9323), the user's choice 2026-10-29; the app is renamed too (plan-v2.md, identifiers kept).

## Next

1. The name is Legato (user's choice 2026-10-29), app and website. Local names follow (identifier
   `app.legato.desktop`, `legato.exe`, moved at first launch by `src-tauri/src/rename.rs`); CLAUDE.md lists what keeps
   the old name for compatibility.
2. Left from the mockup pass (plan-v2.md): Your library ↗ full width, the player bar's "artist · from your file".
3. Before merging: `pnpm check` (all of it) and `pnpm build` in `site/`, then ask the user whether to merge `v2` into
   `master` and push (that push is release 1.0 and the website's first deploy).

`pnpm dev` resumes playback at launch and after every full reload Vite does when a store module changes (settings,
player store): pause it right after edits, or stop the dev app while editing those files.

The column picker the plan mentions already exists ("Display options" button, right-click on a list header).

## Mockups

Figma file "Untitled" (to be renamed "Legato · Design"), through the FigmaBridge MCP: the file must be open in Figma
desktop with Plugins › Development › Figma Bridge running. `screenshot {nodeId, returnImage: true}` shows a screen.

| Screen | Light | Dark |
|---|---|---|
| Songs | 11:5450 | 11:7375 |
| Album | 11:5922 (main) | 11:7758 |
| Search | 11:6142 (main) | 11:8062 |
| Home | 11:6362 (main) | 11:8346 |
| Now Playing | 11:6933 | 11:8602 |
| Components | 11:5248 | 11:8661 |

Variables: collections Theme (light), Dark (`dark/` keys; free plan = one mode per collection), Brand, Scale. The
file's light ink3 is still #6B6B6B; the app uses #606060 (AA on cover tints, `ambient.test.ts`). Brief for the team:
https://claude.ai/artifact/33xMyBxcFnf7pwwmLBdVVQ

## Rules that bit this session

- The user writes in French: answer in French. Code, comments, docs, commits in English (CLAUDE.md).
- No formatter: the repo has no Prettier config and isn't Prettier-clean. Running Prettier rewrites whole files: never
  run it; write lines like the code around them (long single-line JSX is normal here).
- Python isn't installed: multi-line edits with the Edit tool or small node scripts.
- Every UI text through `tr` / `trn` / `msg`, in all 17 `ui/src/shared/i18n/locales/*.ts` (append before the final
  `}`). `i18n.test.ts` fails on a missing text and on one no longer used: remove keys you stop using.
- Sky blue only on the play button and the playing mark. Text in the accent: `text-accent-ink` (darkened until AA).
  Selection `bg-line`, chips ink when picked (`LedChip`), LEDs ink.
- A virtual list whose rows change kind needs `getItemKey` (Up next headers overlapped rows without it).
- Running the app: `pnpm dev` (own data folder; its settings are already at v8, so new v8 defaults don't show there).
  It resumes playback with sound: pause it. Editing many files while it runs (the locales) can leave the player half
  reloaded: restart. Stopping the background task leaves Vite on port 5173 and `target\debug\legato.exe` running:
  stop those two by PID (never the installed app: `AppData\Local\Music App\music-app.exe` until it updates, then
  `AppData\Local\Legato\legato.exe`). A second launch while one runs exits at once (single instance).
- Screenshots of the dev app (computer use): ask access for `C:\dev\music-app\target\debug\legato.exe`; the name
  "Legato" may map to the installed app.
- Without computer use: start `pnpm dev` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  (plus `background::BROWSER_ARGS`), then drive the page over CDP from a node script (global `WebSocket`):
  `Page.captureScreenshot`, `Emulation.setEmulatedMedia` (prefers-color-scheme light / dark), `Input.dispatchMouseEvent`
  for hover. Vite serves modules by URL: `import()` the URL listed in `performance.getEntriesByType('resource')`
  (after HMR it carries `?t=`) to reach the live stores (`usePlayer`, `useStore`, `useSettings`). Pause right after
  each reload and keep checking a few seconds (YouTube's late state can start it again); dev settings have App tint
  on: set it off in memory (`useSettings.setState`, not `update`) to see the default look.
- Small commits on `v2`, `pnpm check` green before each.
