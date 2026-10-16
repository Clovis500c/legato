# UI review: what users love and hate (October 2026)

Research done on 2026-10-16 in official forums, reviews and announcements (sources at the bottom).
Forum posts are anecdotal: we keep the complaints that come up often.

## 1. By platform

| Platform | What people like | What annoys them |
|---|---|---|
| **Spotify** | Drag a track onto a playlist; lyrics well placed under the cover, translated, offline | Desktop "designed for mobile": sparse, wasted space; panels that don't fit together (lyrics, queue, library); tiny, non-resizable cover on big screens; forced thumbnails in the playlist list; "repeat" hidden in a menu (brought back after the backlash); shuffle that replays the same 30 tracks; custom order lost inside folders |
| **Apple Music** | Clean interface once you know it; rich metadata (classical: composer, conductor, movements); continuity across devices | Too many clicks for actions that used to be visible; destinations hidden in menus; search that needs the exact term; divisive "Liquid Glass" redesign |
| **YouTube Music** | Huge catalog (live, remixes, B-sides); search by lyrics or humming; queue synced across devices (2026) | Unreliable queue (no multi-delete, buggy "play next"); messy library (artist = list of tracks, separate tabs); videos and music mixed; "loop" setting lost from one queue to the next |
| **Tidal** | Sober, music-centric, consistent on every platform | A bit complex, not very customizable |
| **Deezer** | Simple and familiar; **themes and color palettes** (Nov 2025); **quick access** pinned at the top of home (suggestions + manual picks) | Seen as basic, not much "fun" |
| **Plexamp** | Now-playing screen takes the cover's colors ("UltraBlur"), one identity per album | — |
| **foobar2000 / MusicBee** | Fully modular layout, skins, the app "your way" | Confusing at first: too many options at once, skins for tinkerers only |

## 2. Lessons

1. **A real desktop app**: dense, columns, useful space. Not a stretched phone app.
2. **Nothing hidden**: common actions visible (on hover) and on right-click. Repeat and shuffle always on screen.
3. **Panels that coexist**: library, queue and info open together, with adjustable width.
4. **A cover at the size you want.**
5. **A reliable queue**: multi-select, reorder, remove, "play next", clear.
6. **Honest shuffle**: true random without repeats, as an option.
7. **A tidy library**: sorting, playlist folders, custom order kept.
8. **Music first**: clips, live versions and covers flagged and filterable.
9. **Customize without getting lost**: ready-made themes, guided editor, preview, "Reset".
10. **An identity per now-playing screen**: colors taken from the cover, flat (no gradient).

## 3. Review of the v3 mockups

| Lesson | v3 | Fix |
|---|---|---|
| 1. Dense | ✓ Column list, adjustable density | Compact mode suggested by default for big libraries |
| 2. Nothing hidden | ✗ No actions on Songs and Playlist rows | **Hover actions** (play, add to playlist, more) + full right-click menu |
| 3. Panels | ✗ Queue only exists in full screen | **Dockable right panel** (queue, info and credits), resizable, open alongside the list |
| 4. Cover | ✗ Fixed size | **Big cover in the right panel** + size setting |
| 5. Reliable queue | ✗ No queue actions | Multi-select with an action bar: play next, remove, clear |
| 6. Shuffle | ✗ Undefined | "Shuffle: true random / balanced by artist" setting |
| 7. Tidiness | ~ Sorting present, no folders | **Playlist folders** in the sidebar; "playlist thumbnails" option on or off |
| 8. Music first | ✗ YouTube results without type | **CLIP / LIVE / COVER** badges + "Hide unofficial videos" filter |
| 9. Customize | ~ Full appearance but 4 fixed themes | **Gallery of 6 themes + theme editor** (colors, font, radii, LEDs, contrast check, `.theme` export) |
| 10. Identity | ✗ | **"Cover tint"** option: deck and now-playing background flat in the dominant color |
| Readability | ✗ Small texts too pale (ink 4 on paper) | Ink 4 reserved for decoration; texts move to ink 3 |

**Lyrics**: much loved elsewhere, but no licensed source is freely available.
We only show them from local files (`USLT` tags or `.lrc` files next to the audio file).

## 4. Themes

- **Ready-made**:
  - Paper (warm light, orange);
  - Graphite (warm dark, orange);
  - Studio (pure OLED black, red);
  - Aluminum (cool light, blue);
  - Bakelite (deep brown, amber);
  - Sage (grey-green light, fir green);
  - System (follows Windows).
- **Editor**:
  - 13 colors (background, panel, surface, ink ×4, lines, accent…) with hex code;
  - font: Hi-Fi or Neutral;
  - LEDs: glow on or off;
  - **contrast checked live** (AA), with a warning when a text becomes unreadable.
- **Sharing**: duplicate, rename, export and import as a `.theme` file (JSON).

## Sources

- Spotify:
  - [new PC UI criticized](https://community.spotify.com/t5/Desktop-Windows/UI-customisation-New-PC-UI-sucks/td-p/7388808);
  - ["New Desktop UI is terrible"](https://community.spotify.com/t5/Your-Library/What-s-up-with-this-new-desktop-UI/m-p/5525644);
  - [request to restore the old interface](https://community.spotify.com/forum/en/discussion/7446756/please-consider-restoring-the-previous-spotify-desktop-experience);
  - [repeat brought back after the backlash](https://www.phonearena.com/news/spotify-repeat-button-now-playing-screen-app-update_id114354);
  - [custom order in folders](https://community.spotify.com/t5/Ongoing-Issues/Custom-Order-sorting-option-missing-inside-folders/idi-p/7403172/highlight/true);
  - [shuffle complaints](https://www.bgr.com/2216137/most-common-customer-complaints-about-spotify/);
  - [improved lyrics](https://techcrunch.com/2026/02/04/spotify-upgrades-its-lyrics-feature-with-offline-access-more-translations).
- Apple Music:
  - [why users leave](https://www.bgr.com/2257028/why-users-ditch-apple-music/);
  - [Trustpilot reviews](https://ca.trustpilot.com/review/applemusic.com).
- YouTube Music:
  - [2026 review](https://www.lissen.com/blog/reviews/youtube-music-review-2026);
  - [user reviews](https://justuseapp.com/en/app/1017492454/youtube-music/reviews);
  - [synced queue](https://www.techradar.com/audio/audio-streaming/youtube-music-just-got-a-big-queue-upgrade-that-users-have-wanted-for-years-and-now-apple-music-fans-are-demanding-the-same).
- Tidal and Deezer:
  - [2026 comparison](https://soundiiz.com/blog/deezer-vs-tidal-which-music-streaming-service-is-best-in-2026/);
  - [Deezer review](https://www.techradar.com/reviews/deezer);
  - [Deezer themes and quick access](https://newsroom-deezer.com/2025/11/deezer-now-lets-you-choose-look-and-layout-of-the-app/).
- Plexamp: [UltraBlur](https://medium.com/@elanf/plexamp-v3-9af3b10063b4).
- foobar2000 and MusicBee: [Head-Fi thread](https://www.head-fi.org/threads/who-else-is-using-foobar2000-in-2025.978240/page-2), [comparison](https://school-of-privacy.com/article/musicbee-vs-foobar2000/).
