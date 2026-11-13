import type { ReactNode } from 'react'
import { GITHUB, PLUGINS_GUIDE } from './content'

// The documentation page (/docs/). English in every language, like the privacy rows: a technical reference is one text
// to keep true, not eighteen. Every line is checked against docs/ and the code (2026-11-13); change it with them.

type Part = string | { list: string[] } | { code: string } | { table: [string, string][]; head: [string, string] }
type Doc = { id: string; title: string; parts: Part[] }

export const USERS: Doc[] = [
  {
    id: 'install',
    title: 'Install',
    parts: [
      'Download the installer from the home page or the releases page and run it, on Windows 10 or 11. There is no account to make: Legato has no server of ours.',
      'New versions install themselves between two songs. Settings › General chooses the channel: Stable, or Beta (every green change on master, so earlier and rougher).',
      'On Android, the APK on the same page installs the phone version of the app.',
    ],
  },
  {
    id: 'first-steps',
    title: 'First steps',
    parts: [
      'The welcome offers the ways in: your music folders, YouTube Music, Spotify, Apple Music or a link. Skip any of them; Settings › Accounts has them all later.',
      { list: ['Press Ctrl+K and search once: results come from every place you connected, merged, one row per song.', 'Right-click anything: every surface has its own menu (play next, add to a playlist, edit song info, credits).', 'The player bar at the bottom keeps the queue, the volume, lyrics and the Now Playing page one click away.'] },
    ],
  },
  {
    id: 'import',
    title: 'Import your music',
    parts: [
      { list: ['A folder: Settings › Accounts adds it; Legato reads the tags on a few threads and only rescans files that changed. Files without tags are matched by their name.', 'YouTube Music: sign in to Google on its own page, in an app window. Legato never sees your password.', 'Spotify: Connect Spotify opens Exportify (a free open-source tool) in a window, then Legato takes in the file it makes. Or paste a public playlist link.', 'Apple Music, Deezer, SoundCloud: paste a public playlist, album or song link anywhere in the app.']},
      'Imported songs are played from YouTube, or from your files when you own them. Legato matches by ISRC first, then title, artist and length. Settings › Privacy lists what each import asked of which site.',
    ],
  },
  {
    id: 'sync',
    title: 'Sync your PCs',
    parts: [
      'Sync Mode (Settings › Sync Mode) keeps several PCs on one library without any server: a shared folder (OneDrive or any other, one file per PC), or the local network with a six-digit code shown on one PC and typed on the other.',
      'On a PC, Add a device can read the other device’s QR code with the webcam: turn on Settings › Playback › Scan QR codes with the webcam (off by default; the camera is asked for only when you press Scan, and no picture is recorded or sent).',
      'What travels: playlists, history, ratings, Live Editor versions, and settings except the ones that belong to one PC. What never travels: file paths, the queue, caches, cookies. Sign-ins travel only inside a file sealed with your password; otherwise you sign in again on the other PC.',
    ],
  },
  {
    id: 'share',
    title: 'Share',
    parts: [
      'Share a playlist as a link, a code or a QR code. The link holds the list itself and is read in the other person’s browser: no server of ours sees it.',
      'To listen together on the same network, a listening room keeps everyone’s playback in step; every message is sealed with a key made from the room’s code.',
    ],
  },
  {
    id: 'stream-deck',
    title: 'Stream Deck',
    parts: [
      'An Elgato Stream Deck plugin ships in the repository (integrations/streamdeck): Play / pause, Next, Previous and a Now playing key with the title and artist. It talks to Legato’s phone remote on this PC or your own network, and to nothing else.',
      { list: ['Turn on Settings › Playback › Phone remote and copy the link it shows.', 'Copy the app.legato.deck.sdPlugin folder into %APPDATA%\\Elgato\\StreamDeck\\Plugins and restart the Stream Deck software.', 'Drag a Legato key onto the deck and paste the link in its inspector.'] },
      'Not tried on a real Stream Deck yet: tell us on GitHub if a key misbehaves.',
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    parts: [
      'The defaults, all rebindable in Settings › Shortcuts. The Global ones also work while Legato is in the background. Media keys are left to Windows, which already sends them to the player.',
      {
        head: ['Action', 'Keys'],
        table: [
          ['Play / pause', 'Space (global: Ctrl+Alt+Space)'],
          ['Next, previous track', 'Ctrl+→ and Ctrl+← (global: Ctrl+Alt+→ and ←)'],
          ['Forward, back 10 seconds', 'Shift+→ and Shift+←'],
          ['Volume up, down', 'Ctrl+↑ and Ctrl+↓ (global: Ctrl+Alt+↑ and ↓)'],
          ['Mute, shuffle, repeat', 'Ctrl+M, Ctrl+S, Ctrl+R'],
          ['Rate the song playing', 'Alt+1 to Alt+5'],
          ['Now Playing, full screen', 'F, F11'],
          ['Karaoke, visualizer, cover display', 'K, V, C'],
          ['Picture-in-picture, A–B loop', 'P, L'],
          ['Search, Settings', 'Ctrl+K, Ctrl+,'],
          ['Back, forward', 'Alt+← and Alt+→'],
          ['Show Legato (global)', 'Ctrl+Alt+M'],
        ],
      },
    ],
  },
]

export const DEVS: Doc[] = [
  {
    id: 'architecture',
    title: 'Architecture',
    parts: [
      'Legato is a Tauri 2 desktop app: a Rust core does the work and a React interface draws it in a WebView2 window. No backend: the library, the settings and the tokens stay on the user’s PC.',
      {
        code: `ui/                     React 19 + Zustand + Tailwind, one folder per feature
  shared/api.ts         the only caller of Rust (Tauri invoke)
src-tauri/              thin shell: commands, keychain, tray, media panel
  crates/core           library (SQLite), matching, sync, mixes, sharing
  crates/connectors     one module per service
  crates/player         audio engine thread, gapless queue
  crates/dsp            live processing: EQ, loudness, tempo
  crates/shield         ad and tracker blocking, scripts for web windows
  crates/plugins        third-party plugin runtime`,
      },
      { list: ['Logic lives in crates/; the shell only connects the crates to the window.', 'The interface never touches the network: images go through the art scheme (host allowlist, disk cache).', 'Secrets live in the OS keychain; the library is local SQLite with versioned migrations.', 'Playback is legal only: official players and the user’s own files. Legato never downloads, records or exports a platform’s audio.', 'Every type crossing IPC is a Rust type exported to TypeScript by ts-rs: a changed Rust type breaks the TypeScript build at once.'] },
    ],
  },
  {
    id: 'plugins',
    title: 'Plugins',
    parts: [
      'A plugin is a folder with plugin.json and main.js, installed from Add-ons › Install a plugin…. Before anything runs, the user sees the author and every permission asked, and approves them. It runs in its own QuickJS engine: no DOM, no fetch, no files; 64 MB of memory and 1 second per run.',
      { code: `{\n  "id": "com.example.my-plugin",\n  "name": "My plugin",\n  "version": "1.0.0",\n  "api": 1,\n  "main": "main.js",\n  "permissions": ["player:read", "ui"]\n}` },
      {
        head: ['Permission', 'Lets the plugin'],
        table: [
          ['player:read', 'see what plays and hear track events'],
          ['player:control', 'play, pause, skip, seek, set the volume'],
          ['library:read / library:write', 'read songs and playlists / make playlists'],
          ['ui, ui:style', 'add menu items and panels / restyle the interface with CSS'],
          ['editor, visualizer', 'use the Live Editor’s settings / draw a visualizer look'],
          ['network:<host>', 'HTTPS requests to that host only'],
        ],
      },
      'Never available: passwords, tokens, files on the PC, other plugins’ data, the app’s own commands. API versions only grow: a later app keeps running API 1 plugins. The full reference, with every app.* call, is the plugin guide; a worked example is examples/plugins/sleep-timer.',
    ],
  },
  {
    id: 'themes',
    title: 'Themes',
    parts: [
      'A theme is a set of colors plus optional CSS, added from Settings › Appearance (24 at most). Light and dark both ship; the default follows Windows. The sky-blue accent is for playback only.',
      'Elements marked data-brand (the name, the logo, legal notices) survive any CSS, a theme’s or a plugin’s. A plugin with the ui:style permission restyles the whole interface the same way.',
    ],
  },
  {
    id: 'build',
    title: 'Build from source',
    parts: [
      'Windows 10 or 11, Rust stable, Node.js 22 or later and pnpm.',
      { code: `pnpm install\npnpm dev      # the app, with its own data, never the installed app's library\npnpm check    # types, lint, tests, clippy, cargo test: green before every commit\npnpm build    # the installer\npnpm e2e      # smoke test of the built app` },
    ],
  },
  {
    id: 'contribute',
    title: 'Contribute',
    parts: [
      'Legato is a personal, source-available project. Issues and pull requests are welcome; open an issue first for a code change so the approach is agreed. A bug report asks for Settings › About › Copy diagnostics.',
      { list: ['Code, comments and commits in English; every interface text goes through the translation tables (17 languages).', 'Small commits, one tested step each, Conventional Commits. Tests never use the real network.', 'The website keeps the privacy rows true: a change that makes the app reach a new host updates them.'] },
    ],
  },
]

const link = 'text-ink underline decoration-line underline-offset-4 hover:decoration-ink'

function Part({ p }: { p: Part }): ReactNode {
  if (typeof p === 'string') return <p className="text-[15px] leading-relaxed text-ink-2">{p}</p>
  if ('list' in p)
    return (
      <ul className="list-disc space-y-1.5 ps-5 text-[15px] leading-relaxed text-ink-2 marker:text-ink-3">
        {p.list.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    )
  if ('code' in p)
    return (
      <pre tabIndex={0} dir="ltr" className="overflow-x-auto rounded-xl border border-line bg-panel p-4 text-[13px] leading-relaxed text-ink">
        <code>{p.code}</code>
      </pre>
    )
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {p.head.map((h) => (
            <th key={h} scope="col" className="border-b border-line pe-6 pb-2 text-start text-xs font-medium text-ink-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {p.table.map(([a, b]) => (
          <tr key={a} className="border-b border-line-soft">
            <th scope="row" className="w-2/5 py-2.5 pe-6 text-start align-top font-medium">
              <code className="text-[13px]">{a}</code>
            </th>
            <td className="py-2.5 text-ink-2">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Group({ label, docs }: { label: string; docs: Doc[] }) {
  return (
    <>
      <h2 className="mt-14 mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase first:mt-0">{label}</h2>
      {docs.map((d) => (
        <section key={d.id} id={d.id} className="scroll-mt-24 border-t border-line py-9">
          <h3 className="mb-4 text-[26px] leading-tight font-black tracking-[-0.01em]">{d.title}</h3>
          <div className="flex max-w-[720px] flex-col gap-4">
            {d.parts.map((p, i) => (
              <Part key={i} p={p} />
            ))}
            {d.id === 'plugins' && (
              <a href={PLUGINS_GUIDE} className={`${link} text-[15px]`}>
                The plugin guide on GitHub
              </a>
            )}
            {d.id === 'architecture' && (
              <a href={`${GITHUB}/blob/master/docs/architecture.md`} className={`${link} text-[15px]`}>
                The full architecture notes on GitHub
              </a>
            )}
          </div>
        </section>
      ))}
    </>
  )
}

/** The page's body: a sticky table of contents beside the sections, for users then developers. */
export function DocsBody() {
  const nav = (label: string, docs: Doc[]) => (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {docs.map((d) => (
          <li key={d.id}>
            <a href={`#${d.id}`} className="block rounded-lg px-2.5 py-1 text-ink-2 hover:bg-panel hover:text-ink">
              {d.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <main id="main" className="mx-auto grid max-w-[1440px] grid-cols-1 gap-x-16 px-(--pad) py-[clamp(40px,6vw,80px)] min-[901px]:grid-cols-[220px_minmax(0,1fr)]">
      <aside aria-label="Documentation sections" className="flex flex-col gap-6 max-[900px]:mb-10 min-[901px]:sticky min-[901px]:top-28 min-[901px]:self-start">
        <h1 className="text-[clamp(34px,4vw,48px)] leading-none font-black tracking-[-0.02em]">Docs</h1>
        {nav('Using Legato', USERS)}
        {nav('For developers', DEVS)}
      </aside>
      <div>
        <Group label="Using Legato" docs={USERS} />
        <Group label="For developers" docs={DEVS} />
      </div>
    </main>
  )
}
