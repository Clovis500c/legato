# Design direction

Source of direction for UI work (the antislop filter reads it as `DESIGN.md`). Proposal 3 of 2026-10-29, adopted for
version 2.0: System (Modern / Modern Dark) carries it. Earlier proposals are in the Figma version history ("Nocturne
v0.1", "Proposal 2 (poster)"). Where the app differs from the mockups: the search stays in the top bar (the window
needs a drag area and its buttons there), with Add-ons and Settings.

Reading this as: desktop music player and library for people whose music lives in several services. Familiar like
Spotify and YouTube Music, denser and calmer than both.

Dial (app): ENERGY 2 / RHYTHM 2 / MOTION 1. Dial (landing page): ENERGY 2 / RHYTHM 2 / MOTION 1.

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
- Song lists default to Compact: 40 px rows, Title, Artist, Album, Source, heart, Time as columns. Comfortable (56 px,
  with covers) is one click away. Columns are chosen from the list header.
- Up next keeps three blocks: Now playing, Next added by you (always first), Then from the playlist or album.
- Album, playlist and artist pages open with a band in a tint of the cover (light) or a deep tone of it (dark).
- Now Playing: the same cover tone, flat, with the title in Display XL.
- Like, play next and add to playlist sit on the row (hover) and in the player, never only in a menu.

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
- Primary buttons are ink with bg text. Service colors (Spotify green, YouTube red, Apple pink) stay in their badges.
- No gradients, glows or glass.

## Type

Roboto only, the font of YouTube and YouTube Music, already bundled (`@fontsource-variable/roboto`). Numbers use
tabular figures.

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

## Shape, icons, motion

- Radius: 4 covers, 6 rows and tiles, 8 panels and cards, pill for buttons, chips and search (the shapes of YouTube
  and Spotify, which these listeners use daily), round for the play button and artist photos.
- Flat. One shadow, for menus and dialogs over content.
- Icons: Phosphor (already in the app). Regular at rest, Fill when active.
- Motion: hover and pressed 120 ms, panels 200 ms, opening Now Playing 240 ms. No loops. Settings › Animations off
  removes it.
