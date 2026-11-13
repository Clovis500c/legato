# Writing a plugin

A plugin adds a feature to Legato: menu items, a panel, a new look, reactions to what plays, a link to a web
service. It is a folder with two files, installed by the user from **Add-ons › Install a plugin…**. Before anything
runs, the user sees who made it and every permission it asks for, and approves them.

Example: [`examples/plugins/sleep-timer`](../examples/plugins/sleep-timer) (pauses the music after a while, with a
fade).

## The folder

```
my-plugin/
  plugin.json   the manifest
  main.js       the code (one file: bundle if you use several)
  README.md     optional; .md .txt .png .css .json files are copied too (50 files, 5 MB at most)
```

`plugin.json`:

```json
{
  "id": "com.example.my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What it does, in one or two sentences.",
  "api": 1,
  "main": "main.js",
  "permissions": ["player:read", "ui"],
  "homepage": "https://example.com/my-plugin"
}
```

- `id`: 3-64 characters, `a-z 0-9 . -`. Installing a folder with the same id updates the plugin; new permissions
  are pointed out and approved again.
- `api`: the plugin API version you wrote for. This app offers **1**; a plugin asking for more is refused with "needs
  a newer version of Legato". Versions only grow: a later app keeps running API 1 plugins.
- `main`: a `.js` file next to `plugin.json`, 2 MB at most.

## Permissions

| Permission | Lets the plugin |
|---|---|
| `player:read` | see what plays (`app.player.state()`), hear `track` and `playing` events |
| `player:control` | play, pause, skip, seek, set the volume, play songs from the library |
| `library:read` | read songs and playlists (no file paths) |
| `library:write` | make playlists and add songs to them |
| `ui` | add menu items, show a panel, show notifications (named after the plugin) |
| `ui:style` | restyle the whole interface with CSS |
| `editor` | read and change the Live Editor's settings |
| `visualizer` | offer a look for the visualizer, hear the music's levels while it shows, draw it |
| `network:<host>` | HTTPS requests to that host only, e.g. `network:api.example.com` |

Without any permission a plugin still has its own storage, timers and log.

Never available, whatever the permissions: the user's passwords, tokens and sign-ins, files on the PC, other
plugins' data, the app's own commands, the internet beyond the hosts listed.

## How it runs

Each plugin runs in its own JavaScript engine (QuickJS) inside the app, on its own thread: no web page, no DOM, no
`fetch`, no `require`, no files. Modern JavaScript (classes, `async` / `await`, `Map`, `Promise`, `JSON`, `Date`…) is there,
plus `console.log/warn/error` (shown in the plugin's About › Log), `setTimeout`, `setInterval` (50 ms at least) and
their `clear` functions (64 at most). Limits: 64 MB of memory; each run of its code (start, an event, an answer, a
timer) may take 1 second, after which it is interrupted; interrupted 3 times, the plugin is stopped and its card shows
why. 256 calls can wait for an answer at once.

Everything else goes through the global `app` object. Every call returns a `Promise`; it is rejected with an `Error`
when a permission is missing ("Permission needed: player:control") or the call fails.

## `app` reference (API 1)

```js
app.id, app.api, app.appVersion

// Events. Returns a function that removes the handler.
app.on('track', (t) => {})      // song started: { title, artist, trackId (library id or null), via } or null
app.on('playing', (yes) => {})  // true / false
app.on('panel', ({ id, value }) => {})   // a control of your panel was used
app.on('command', ({ id, context }) => {}) // also run by addCommand's `run`

// player:read / player:control
await app.player.state()   // { track, playing, positionMs, durationMs, volume (0..1) }
await app.player.play(); await app.player.pause(); await app.player.toggle()
await app.player.next(); await app.player.previous()
await app.player.seek(ms); await app.player.volume(0.5)
await app.player.playTracks([trackId, …], startIndex)

// library:read / library:write
await app.library.tracks()      // [{ id, title, artist, album, durationMs, sources: ['youtube', …] }]
await app.library.playlists()   // [{ id, name, custom, source, trackCount }]
await app.library.playlist(id)  // { id, name, custom, tracks: […] }
await app.playlists.create(name)      // new playlist id
await app.playlists.add(id, [trackId, …])

// ui
await app.ui.notify('Done')
await app.ui.addCommand({ id: 'x', title: 'Do it', where: ['player', 'track', 'playlist'], run: (context) => {} })
//   context: track { trackId, title, artist }, playlist { playlistId, name }, player { trackId, title, artist }
await app.ui.removeCommand('x')
await app.ui.setPanel([ …parts… ])   // shown from the plugin's cog in Add-ons

// ui:style
await app.ui.setStyle('.some-class { … }')   // links and @import are taken out

// editor
await app.editor.get()          // Live Editor settings (speed, tempo, pitch, bass, eq, reverb, echo, space…)
                                // eq: 10 gains in dB, 32 Hz to 16 kHz an octave apart (5 gains = the older bands)
await app.editor.set({ ...settings, speed: 0.8 })

// visualizer
await app.visualizer.register({ name: 'Rings' })  // your look among the visualizer's styles (one per plugin)
app.on('visualizer', (f) => {})  // while your look shows and music plays: 30 a second at most, the latest only
//   { bands: [31 numbers 0..1, low to high, a third of an octave apart], beat (a beat since the last frame),
//     bpm (or null), level and peak (the louder side, dBFS) }
app.visualizer.draw([ …shapes… ])  // the picture until the next one; nothing comes back, 60 a second, 256 kB each

// storage (always allowed, 1 MB per plugin, JSON values)
await app.storage.set('key', { any: 'json' }); await app.storage.get('key')
await app.storage.remove('key'); await app.storage.keys()

// network:<host>
const r = await app.net.fetch('https://api.example.com/v1/x', { method: 'POST', headers: { 'X-Api-Key': '…' }, body: '…' })
// { status, contentType, body (text) }; JSON.parse(r.body) for JSON
```

Network rules: `https://` only, to an approved host; redirects only within that host; the host must resolve to a
public address (no LAN, no localhost); no cookies, no proxy; 1 MB sent, 2 MB received, 15 seconds; `Cookie`,
`Host`, `Origin` and `Sec-*` headers can't be set.

### Panel parts

A panel is data, drawn by the app in its own look (no HTML from plugins). Unknown parts are dropped; 300 parts, 6
levels at most.

```js
{ type: 'heading', text }
{ type: 'text', text, muted? }
{ type: 'button', id, label, primary? }              // panel event: { id, value: null }
{ type: 'toggle', id, label, value }                 // value: true / false
{ type: 'slider', id, label, min, max, step?, value } // value: number
{ type: 'input', id, label, value }                  // value: text (on Enter or leaving the field)
{ type: 'select', id, label, value, options: [{ value, label }] }
{ type: 'tracks', ids: [trackId, …] }                // library songs, click to play
{ type: 'row', children: [ …parts… ] }
{ type: 'divider' }
```

Controls show the value you give: after an event, call `setPanel` again with the new state.

### Visualizer shapes

A picture is data too, drawn by the app on the visualizer's canvas, full screen or in the strip. Positions are shares
of the box: `x` 0 (left) to 1 (right), `y` 0 (top) to 1 (bottom), -1 to 2 to go past the edges. A circle's `r` is a
share of the box's shorter side; widths and text sizes are CSS pixels. `color`: `'ink'` (the visualizer's own colour,
the default), `'warn'` (its alarm red) or `#rgb` / `#rrggbb` / `#rrggbbaa`; `alpha` 0..1, 1 by default. Unknown shapes
are dropped; 1000 shapes and 8000 points at most.

```js
{ op: 'rect', x, y, w, h }                             // filled
{ op: 'line', points: [x1, y1, x2, y2, …], width? }    // width 1.5 by default
{ op: 'shape', points: [x1, y1, x2, y2, x3, y3, …] }   // closed and filled
{ op: 'circle', x, y, r, width? }                      // a ring that wide; width 0 (the default): a disc
{ op: 'text', x, y, text, size?, align? }              // y is the text's middle; size 14, align 'left' / 'center' / 'right'
```

Frames come only while your look is on screen with music playing, so a plugin draws nothing the rest of the time.
When your plugin is off or stopped, the visualizer shows its bars in your look's place. Example:
`examples/plugins/rings`.

## Try it

1. Write the folder anywhere.
2. Add-ons › Install a plugin… › pick the folder › Install.
3. Change the code, install the folder again (same id: it updates and restarts).
4. Errors and `console.log` lines: the plugin's About (ⓘ) › Log.

## Versions of this API

- **1** (2026-10): everything above; `visualizer` (permission, calls, event, shapes) added
  within API 1 in 2026-11.

New features come as new methods, events or parts within API 1 when nothing existing changes meaning; anything that
would break a plugin waits for API 2, and API 1 plugins keep working.
