# Design direction

Source of direction for UI work. Proposal 3 of 2026-10-29, adopted for
version 1.0: System (Modern / Modern Dark) carries it. Earlier proposals are in the Figma version history ("Nocturne
v0.1", "Proposal 2 (poster)"). Where the app differs from the mockups: the search stays in the top bar (the window
needs a drag area and its buttons there), with Add-ons and Settings.

Reading this as: desktop music player and library for people whose music lives in several services. Familiar like
Spotify and YouTube Music, denser and calmer than both.

Dial (app): ENERGY 2 / RHYTHM 2 / MOTION 2 (more motion, user's request 2026-10-29). Dial (website, user's choice
2026-10-31): ENERGY 2 / RHYTHM 2 / MOTION 3, for the scroll story only ([Website](#website)).

## What listeners ask for (research, 2026-10-29)

From Spotify's community forum, YouTube Music reviews and press coverage of their redesigns:

- Desktop redesigns that copy mobile waste space: users went from 50-70 songs on screen to about 20. They want a
  compact view everywhere, artist in its own column, a density setting, chosen columns.
- The library sidebar should resize and be able to fill the window.
- Queued songs should play next, not land at the end of the queue.
- Spotify has been asked for a light mode for over ten years; users want light, dark, or follow the OS.
- Removing a visible like button caused a backlash: saving a song must stay one click.
- Hidden features (actions behind "...", removed buttons) and poor readability are recurring complaints.
- Praised: clarity and consistency, drag and drop to build playlists, lyrics that open in one click.

Each rule below answers one of these.

## Layout

- Layered panels on a window background (8 px gaps, 8 px corners): sidebar, main pane, Up next, player bar.
- Sidebar: Home, Mixes, Stats; then Your library with kind chips (Playlists, Albums, Artists) and items with cover,
  kind and count. Resizable, with a button to open the library full width.
- Song lists default to Compact: 40 px rows with a small cover, Title, Artist, Album, Source, heart, Time as columns.
  Comfortable (56 px, bigger covers) is one click away. Columns are chosen from the list header. The mockups' compact
  rows have no cover; the app shows one by default (user's pick 2026-10-29), Settings › Appearance › Covers in lists.
- Up next keeps three blocks: Now playing, Next added by you (always first), Then from the playlist or album.
- Album, playlist and artist pages open with a band in a tint of the cover (light) or a deep tone of it (dark).
- Now Playing: the same cover tone, flat, with the title in Display XL.
- Like, play next and add to playlist sit on the row (hover) and in the player, never only in a menu.

## Simplicity on the PC

The owner's ask (2026-11-05, plan-v2 › Against Liner › U2): fewer controls in sight on each surface, calm, generous
room; nothing removed, every feature one menu away (no fake buttons). The phone's own rules are below.

- **One More (⋯) per surface** holds the rare actions, the same menu as a right-click there. Player bar: Lyrics,
  Up next, the volume, More, Now Playing; picture in picture, the sleep timer, Karaoke, Cover display, share, the Live
  Editor are in More (`playerMenu({ controls: false })`). The sleep timer's moon shows in the bar only while a timer
  runs, or always with Settings › Appearance › Sleep timer button.
- **Now Playing:** the cover and the song; under them the like and add-to-playlist, the transport, then Lyrics, Up
  next, Sound, More and the volume. Less like this, Karaoke (K) and Cover display (C) are in More. The Show switch
  (Auto, Video, Cover) shows only when there's a video to pick; it's in More too.
- **Page headers:** a page without a band (Songs, Albums, Artists, Stats…) has a 40 px title, not Display L; a band
  (album, playlist, artist) keeps Display L. The playability pill is its LED and an i, the words in its tooltip and in
  the box it opens.
- **Top bar:** Back and Forward are drawn only when they can go somewhere (their place kept, the search doesn't move);
  the search's shortcut keys show under the pointer only (Settings › Shortcuts lists them).
- **Sidebar:** Your library's Expand and Sort buttons show under the pointer or on keyboard focus (always when open
  wide, on a touch screen and on the phone); New playlist (+) stays.

## Phone

The layout under 640 px (`phone:` in `styles.css`, `usePhone()` in `shared/phone.ts`): the Android app, a narrow
window never reaches it. Rewritten on 2026-11-06 (plan-v2 › Against Liner › U1: the owner found it too busy, badly
arranged for a thumb). Liner's calm is the spirit, never its look. The rules:

- **Less in sight, nothing lost.** Every feature stays reachable; what a screen doesn't need often moves into a sheet,
  a menu or a More (⋯), never away. Desktop-only rows stay hidden on the phone app (`settings/desktopOnly.ts`).
- **One main action per screen**, in the accent where it plays (the round play), the rest plain icons.
- **Thumb's reach.** The bottom tabs (Home, Search, Your library, Mixes), the mini player above them, Now Playing's
  controls at the foot of the screen. Every tap target is 44 px at least: `RoundButton` adds an invisible 8 px ring on
  the phone (its drawn size stays), the top bar's buttons are 40 to 44 px, menu rows 48 px. That ring reaches past a
  row's edge, so a box that scrolls down never scrolls sideways there (`styles.css`: `overflow-y-auto` clips x on the
  phone; a box that scrolls both ways says `overflow-x-auto`), and a row wider than its scroller is a bug.
- **Menus are sheets.** Every menu (long press, ⋯, a dropdown) opens as a sheet from the bottom edge (`ContextMenu`'s
  `Sheet`): rows of 48 px, a submenu takes the sheet's place with a Back row on top, a tap outside closes it.
- **Gutters of 16 px** (24 on the desktop); a band (album, playlist, artist) reaches the screen's edges.
- **Headers don't eat the screen.** Page titles 28 px, two lines at most; a band's cover 160 px, centered over the
  title; one line of detail under it. The tools row (play, shuffle, Auto-DJ, then sort, display, playability as icons)
  is one row; chips are one row scrolled sideways, edge to edge.
- **Top bar:** the logo or Back, never both (Home is a tab); the search field; Settings. Hidden under Now Playing.
- **Search tab** opens the Search page with the field focused; the top result is one row (cover, name, play); the
  filter switch sits in a ⋯ at the chips' end.
- **Mini player:** cover, title and artist as one tap target opening Now Playing, then the heart, play and next.
- **Now Playing** is a phone player: its own bar (close, where it plays from, More), the cover as big as the width
  allows, title and artist on the left with the heart beside them, the seek bar, the transport (shuffle, previous,
  play, next, repeat), then Lyrics, Up next and Sound spread under the thumb. An open panel takes the cover's place.
  More holds the rest: Show (Auto, Video, Cover), Less like this, Karaoke, Cover display, share, the Live Editor,
  sleep timer, playlists, rating, bookmarks, go to album or artist.
- **Your library tab:** Stats and Add music side by side (Home and Mixes are tabs), then the library list.
- **Settings:** the sections as one row of chips under the settings search; in each section the common groups first,
  the rare ones folded under "Advanced" at the foot (`settings/phoneFold.ts`), a search result opening its fold.
- **List rows:** 56 px at least, two lines (title; artist or one detail), the menu's ⋯ at the end, a tap plays.
- **Dialogs are sheets** too (`shared/ui/Dialog.tsx`): the full width from the bottom edge, rounded on top, their
  buttons above the system bar.
- **Add music:** one card per row, the icon beside its title; the sources' LEDs stay in Settings › Accounts.
- **Mixes:** Reset history at the page's foot, under the explanation, not beside the title.
- **Full screens** (Karaoke, Cover display, visualizer) show no keyboard hints: a phone has no Esc or arrows.
- **The video's place:** a YouTube song's video shows in Now Playing only (Show: Auto, Video, Cover); elsewhere the
  song plays out of sight, as Cover mode does, and the mini player says what plays. No floating card over the lists
  (the owner's try, 2026-11-06; against YouTube's terms as Cover mode is, one line in `MiniPlayer.tsx`). A video that
  can't reach YouTube shows our words and Try again over it, never the browser's error page or its address
  (`player/ytDown.ts`); out of sight, nothing.
- **Back** (Android's button or gesture) closes what's on top, one press at a time: a menu or sheet, the newest dialog,
  a full screen (visualizer, Cover display, Karaoke), Now Playing, then the page before. At the root the app goes
  behind the others and the music goes on (`app/androidBack.ts`, `MainActivity.kt`). A new overlay joins
  `shared/ui/layers.ts`, as `Dialog` does, or Back walks past it.

## Palette

Names match `PALETTE_KEYS` (`ui/src/shared/theme/theme.ts`).

| Key | Light | Dark |
|---|---|---|
| bg | #FFFFFF | #131313 |
| panel | #F7F7F5 | #171717 |
| raised | #EFEFEC | #232323 |
| recess | #E6E6E3 | #050505 |
| line | #DEDEDA | #2C2C2C |
| lineSoft | #ECECE9 | #1E1E1E |
| ink | #0F0F0F | #F1F1F1 |
| ink2 | #565656 | #B3B3B3 |
| ink3 | #606060 | #8C8C8C |
| ink4 | #A8A8A8 | #4A4A4A |
| accent | #7CB8FF | #7CB8FF |
| onAccent | #0F0F0F | #0F0F0F |
| ledOff | #D2D2CE | #3A3A3A |

- Light or dark follows Windows; both are designed for every screen.
- Sky blue is playback: the play button and the marker on what plays, black icon on top (9:1). No other control is
  sky blue. Never text on light (2:1 on white); on dark it can be text (9:1). Lighter and more lavender than Windows
  11's own dark-mode accent (#60CDFF), so it does not read as a stock Windows control. Selection stays grey, so
  "selected" and "playing" never look alike.
- Accent color › Cover (a choice): the song in the player gives the accent, its cover's hue made vivid and 3:1 on the
  background; the theme's own while none is loaded or the cover is grey. Still playback only; selection stays grey.
- Primary buttons are ink with bg text. Service colors (Spotify green, YouTube red, Apple pink) stay in their badges.
- No gradients or glass on surfaces. Glow, yes (the owner's call 2026-11-05, replacing "no glows"): see below.

## Glow

The owner's call (2026-11-05, plan-v2 › Against Liner › U2): our interface lacked the glow Liner has; take a little of
the spirit, never its look. A soft light around **what plays and what matters**, nowhere else:

- In the accent: the play buttons (every `RoundButton kind="primary"`, the accent `Button`; the cards' hover play
  buttons keep their dark lift instead: the classes sit in the components layer, a shadow utility wins), the playing row's mark
  (lists, album and artist pages, Up next), the progress bar's played part (a strip of light under the ink line; the
  phone's thin line too).
- Ink, dark themes only: what's on (a picked chip, a switch that's on), and the theme's lit LEDs (Theme Studio's LED
  glow). An ink halo on a light theme would be a dark smudge: none there.
- The sung line of the lyrics and Karaoke (ink in dark themes, the accent in light ones).
- Now Playing's cover: a light of the cover's own most present colour behind it (`useCoverHue`, the vivid hue the
  visualizer uses), none on a grey cover or a video.
- How much: Settings › Appearance › Player › Glow, **Off / Soft / Strong**, Soft by default. Dark themes get the full
  amount, light ones about half. Off means none at all (every value is `none`, `glow.test` in `theme.test.ts` says so;
  the docked mini player's cover wash goes too, and no cover is read for a light). Windows' high contrast drops them.
- Cheap to draw: static `box-shadow`s and one `drop-shadow` filter on the sung line, values from `glowVars` in
  `theme.ts` as CSS variables (`.glow`, `.glow-mark`, `.glow-bar`, `.glow-on`, `.glow-sung` in `styles.css`). Never
  animated, never a `backdrop-filter` on a large layer (a live blur over the window costs every repaint,
  `immersive.ts`). Text stays on flat colour: a glow never lowers a text's contrast.

## Type

Roboto for every word, the font of YouTube and YouTube Music, already bundled (`@fontsource-variable/roboto`). Geist
Mono only for what reads as data: codes, links, paths, keys, hex colours, some counters. Numbers use tabular figures.

| Style | Weight | Size / line |
|---|---|---|
| Display XL | Black | 88 / 92, -2% |
| Display L | Black | 56 / 60, -1.5% |
| Display M | Bold | 32 / 38, -1% |
| Title L | Bold | 22 / 28 |
| Title M | Medium | 16 / 22 |
| Title S | Medium | 14 / 20 |
| Body M | Regular | 14 / 20 |
| Body S | Regular | 13 / 18 |
| Label | Medium | 12 / 16 |

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
| Website landing | 11:8927 | 11:10438 |
| Brand (name and icon) | 11:9323 | |

Variables: collections Theme (light), Dark (`dark/` keys; free plan = one mode per collection), Brand, Scale. The file's
light ink3 is still #6B6B6B; the app uses #606060 (AA on cover tints, `ambient.test.ts`).

## Shape, icons, motion

- Radius: 4 covers, 6 rows and tiles, 8 panels and cards, pill for buttons, chips and search (the shapes of YouTube
  and Spotify, which these listeners use daily), round for the play button and artist photos.
- Flat. One shadow, for menus and dialogs over content; the glow above is light, not depth.
- Icons: Phosphor (already in the app). Regular at rest, Fill when active.
- Motion: hover and pressed 120 to 150 ms, panels 200 ms, opening Now Playing 240 ms. Icons answer: arrows lean the
  way they go on hover, the Settings gear turns, a heart or a toggle pops when clicked (`shared/motion.ts`), play /
  pause, the volume icon and the open page's icon grow in when they change. Sections, tiles and cards come in one after
  another (30 ms apart, `.stagger`), the right panel slides in, a new song's title rises in the player bar, a card's
  play button rises into place. Transform and opacity only, no loops. Settings › Animations off removes it; Windows'
  animation effects off leaves fades only.

## Website

The app's look, and one scroll story around the app itself (user's choice 2026-10-31). Five lines to judge a change by:

- Product: a Windows player for people whose music is scattered.
- Character: dense, calm, frank.
- World: a hi-fi in the evening (LED bars, VU meters, record bins).
- Moments: the 3D window that stays on screen, and the visualizer's chapter, where the page goes dark.
- Signature: a player bar for the page itself, the chapter as the song, the next one as Up next, the scrubber as the
  chapters. Sky blue only on its playing mark, as in the app.

Rules:

- The window is the real interface (`site/demo`), never a redrawn one. 6 to 8 chapters; the rest is a list.
- Text sits on calm page space, never over the window.
- Native scroll and `position: sticky`, no hijacking. Transform and opacity only. The stage follows the scroll through
  a spring with no overshoot, so a wheel's notches move it in one glide; the window is its own layer only while it moves
  (sharp again at rest, where its zoom can pass 1).
- One exception to "Flat": a neutral shadow under the window, which follows its tilt. No glow, glass or gradient.
- Wide screens with animations on get the stage. Under 1000 px, a phone instead of the window (the owner's ask
  2026-11-06): its screen 375×812, so the interface takes its phone layout (a chapter that shows a PC-only place plays
  its phone twin: Now Playing on Up next for the queue), less tilt, always under the chapter's text, the site's header
  out of the way while a chapter holds. Its demo starts on the visitor's first scroll, never with Save-Data, and steps
  back to the pictures under 20 frames a second. Taken, it fades into the interface at the stage's own size (a real
  phone's taps), Back to the page under it; Android's way out is the APK, an iPhone's the Windows app and a word.
- Reduced motion gets the chapters one after another, each with a picture (the phone's under 1000 px).
- In the demo, artists, songs and covers are invented; it makes no sound and reaches no network.
