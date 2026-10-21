# Writing a plugin

A plugin adds a feature to Music App: menu items, a panel, a new look, reactions to what plays, a link to a web
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
  a newer Music App". Versions only grow: a later app keeps running API 1 plugins.
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
await app.editor.set({ ...settings, speed: 0.8 })

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

## Try it

1. Write the folder anywhere.
2. Add-ons › Install a plugin… › pick the folder › Install.
3. Change the code, install the folder again (same id: it updates and restarts).
4. Errors and `console.log` lines: the plugin's About (ⓘ) › Log.

## Versions of this API

- **1** (Music App, 2026-10): everything above.

New features come as new methods, events or parts within API 1 when nothing existing changes meaning; anything that
would break a plugin waits for API 2, and API 1 plugins keep working.
