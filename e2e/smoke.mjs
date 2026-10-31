// pnpm e2e: the smoke test. Builds the app as a guest (debug, cargo feature `e2e`: its own identifier, the network on a
// loopback mock, no audio device) and walks a new user's first minutes through its real window, over WebView2's
// DevTools port (scripts/cdp.mjs):
//   launch       fresh data: the welcome comes first
//   welcome      Get started, Add folder (the demo songs this script writes), Start listening
//   songs        the library lists the three songs
//   play         a local song plays 3 s: the engine's position moves, sound goes through the live chain
//   pause-play   Pause freezes it, Play moves it again
//   search       typed text: suggestions, then YouTube, YouTube Music and Apple results, all from e2e/mock.mjs; the song plays on
//   links        a pasted Deezer playlist (Add music) and Apple album (Ctrl+V): the progress toast, Cancel, the playlist made
//   quit         "Keep running in the notification area" off, the window's Close: the app ends by itself, exit code 0
//   relaunch     the same data again: no welcome, the library is there; one more quit
// The native folder picker is an OS dialog a page can't drive: the script answers its IPC request (CDP Fetch). Nothing
// else is faked on the page; the app's own side is the e2e build (src-tauri/src/hosts.rs, crates/player/src/output.rs).
// Its data folders are the only folders this script deletes; in the --shots folder it removes just the few files an
// earlier walk wrote there, by name (clearShots). Under 5 minutes of test time; the build comes before.
//
//   pnpm e2e                 build, then run
//   --skip-build             keep target/e2e/legato-e2e.exe when its inputs have not changed
//   --build-only             build, then stop
//   --repeat <n>             run the walk n times on the one build (flakiness check)
//   --keep                   leave the data folders after the run
//   --shots <dir>            PNGs, and on failure failure.txt and the diagnostics log (default target/e2e/shots); any
//                            folder: a walk replaces its own files there and leaves the rest

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Cdp, sleep, waitForPage } from '../scripts/cdp.mjs'
import { browserArgs, carriesId, freePort, inputsHash } from '../scripts/guest.mjs'
import { APPLE_LINK, DEEZER_LINK, startMock } from './mock.mjs'
import { DEMO_SONGS, writeDemo } from './wav.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONF = path.join(ROOT, 'src-tauri', 'tauri.e2e.conf.json')
const OUT = path.join(ROOT, 'target', 'e2e')
const EXE = path.join(OUT, 'legato-e2e.exe')
const BUILT = path.join(ROOT, 'target', 'debug', 'legato.exe')
const DEMO = path.join(OUT, 'demo')
export const E2E_ID = 'app.legato.desktop.e2e'
/** In the exe of an `e2e` build and in no other: the variable hosts.rs reads. */
export const FEATURE_MARK = 'LEGATO_E2E_MOCK'
const WATCHDOG_MS = 4 * 60 * 1000

// ---- Pure parts (e2e/e2e.test.ts) ----

export function parseArgs(argv) {
  const o = { skipBuild: false, buildOnly: false, repeat: 1, keep: false, shots: path.join(OUT, 'shots') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--skip-build') o.skipBuild = true
    else if (a === '--build-only') o.buildOnly = true
    else if (a === '--keep') o.keep = true
    else if (a === '--shots') o.shots = argv[++i] ?? ''
    else if (a === '--repeat') o.repeat = Number(argv[++i])
    else throw new Error(`unknown option ${a} (the top of e2e/smoke.mjs lists them)`)
  }
  if (!Number.isInteger(o.repeat) || o.repeat < 1 || o.repeat > 50) throw new Error('--repeat takes a number from 1 to 50')
  if (!o.shots) throw new Error('--shots takes a folder')
  return o
}

/** The two folders this script may delete. Any other identifier: refused, so the installed app's data is out of reach. */
export function e2eFolders(id, appData, localAppData) {
  if (id !== E2E_ID) throw new Error(`the smoke test identifier is ${E2E_ID}, not ${id}`)
  for (const base of [appData, localAppData]) if (!base || !path.win32.isAbsolute(base)) throw new Error('APPDATA and LOCALAPPDATA must be set')
  return [path.win32.join(appData, id), path.win32.join(localAppData, id)]
}

/** The app's environment: DevTools port and the build's flags for WebView2, the mock's address, and every other host
 *  behind a dead proxy (reqwest reads it; loopback stays direct): a call the mock does not stand for fails at once. */
export function appEnv(base, { flags, mock }) {
  const dead = 'http://127.0.0.1:9'
  // Names differ by case on other systems, not on Windows: drop whatever the shell carries before setting ours.
  const kept = Object.fromEntries(Object.entries(base).filter(([k]) => !/^(http|https|all|no)_proxy$/i.test(k) && k !== 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS' && k !== FEATURE_MARK))
  return { ...kept, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: flags, [FEATURE_MARK]: mock, HTTP_PROXY: dead, HTTPS_PROXY: dead, ALL_PROXY: dead, NO_PROXY: '127.0.0.1,localhost' }
}

/** What is wrong with a song's position `moved` ms further after `wall` ms by the clock, or '' when it kept time. */
export function pace(moved, wall) {
  if (moved < wall * 0.6) return `the position moved ${moved} ms in ${wall} ms: the song does not play`
  if (moved > wall + 1000) return `the position moved ${moved} ms in ${wall} ms: ahead of the clock`
  return ''
}

/** Whitespace as one space: tab and chip labels carry line breaks. */
export const flat = (s) => String(s).replace(/\s+/g, ' ').trim()

/** The pictures the walk takes (`shot`) and its steps (`step`, named in FAIL-<step>.png): e2e.test.ts keeps both lists equal
 *  to the walk's own calls. */
export const SHOTS = ['1-welcome', '2-library', '3-songs', '4-playing', '5-search', '5-imported', '6-settings', '7-relaunch']
export const STEPS = ['launch', 'welcome', 'songs', 'play', 'pause-play', 'karaoke', 'search', 'links', 'quit', 'relaunch']

/** What the app's log says started its deferred work (src-tauri/src/deferred.rs), once per launch. */
export const DEFERRED_BY = { ready: 'deferred start by the UI ready signal', timer: 'deferred start by the timer' }

/** The log's launches by cause: { ready, timer }. A walk is wrong when the timer started the work (the page never said
 *  ready in time) or nothing did. */
export function deferredStarts(log) {
  const lines = String(log).split('\n')
  return { ready: lines.filter((l) => l.includes(DEFERRED_BY.ready)).length, timer: lines.filter((l) => l.includes(DEFERRED_BY.timer)).length }
}

/** Every file a walk writes in the shots folder, by exact name. */
export const shotFiles = () => [...SHOTS.map((n) => `${n}.png`), ...STEPS.map((s) => `FAIL-${s}.png`), 'failure.txt', 'diagnostics.log']

/** The shots folder at a walk's start: it exists, and the files an earlier walk wrote there are gone. --shots may name any
 *  folder (the repo, Pictures): nothing else in it is touched, and the folder itself is never emptied or removed. */
export function clearShots(dir) {
  mkdirSync(dir, { recursive: true })
  for (const f of shotFiles()) rmSync(path.join(dir, f), { force: true })
}

// ---- Process and build ----

const started = new Set()

/** Stops a process this script started (and its children), by PID, after checking the PID still is our exe. */
function stop(pid) {
  const name = path.basename(EXE)
  const listed = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  if (listed.toLowerCase().includes(`"${name}"`)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  started.delete(pid)
}

function running() {
  const name = path.basename(EXE).toLowerCase()
  const listed = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(EXE)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  return listed
    .split('\n')
    .filter((l) => l.toLowerCase().startsWith(`"${name}"`))
    .map((l) => l.split('","')[1])
}

function fail(message) {
  console.error(`e2e: ${message}`)
  process.exit(1)
}

/** `tauri build --debug --no-bundle --features e2e`, then the exe copied to its own name and folder: only this script
 *  writes target/e2e, so what runs there never is the dev build `pnpm dev` leaves in target/debug. */
function ensureBuild(o) {
  const stamp = `${EXE}.inputs`
  const hash = inputsHash(ROOT)
  if (o.skipBuild && existsSync(EXE) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) {
    console.log('build: inputs unchanged, reusing target/e2e/legato-e2e.exe')
    return
  }
  console.log('build: tauri build --debug --no-bundle --features e2e')
  const built = spawnSync('pnpm tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json', { cwd: ROOT, stdio: 'inherit', shell: true })
  if (built.status !== 0) fail('the build failed')
  mkdirSync(OUT, { recursive: true })
  copyFileSync(BUILT, EXE)
  writeFileSync(stamp, hash)
}

// ---- The page, as a user reaches it ----

/** Where to look: 'dialog' = in the open dialog if there is one (what a modal covers cannot be pressed), else the page;
 *  'page' = the whole page (a toast over a dialog); 'transport' = the player's own buttons (Shuffle, Previous, Play,
 *  Next, Repeat), not a list's Play button of the same name. */
const SCOPES = {
  dialog: "(document.querySelector('[role=dialog]') || document)",
  page: 'document',
  transport: "([...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Previous' && b.getBoundingClientRect().width)?.parentElement ?? document.createElement('div'))",
}

/** The first button, link, tab or switch that carries this text (or aria-label), in a scope above. `free` = nothing
 *  stands over its middle (a toast would eat the click). */
const where = (label, scope = 'dialog') => `(() => {
  const want = ${JSON.stringify(label)}
  const root = ${SCOPES[scope]}
  const el = [...root.querySelectorAll('button, a, [role=button], [role=tab], [role=switch]')].find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().split('\\n')[0].trim() === want)
  if (!el) return null
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const x = r.x + r.width / 2
  const y = r.y + r.height / 2
  const top = document.elementFromPoint(x, y)
  return { x, y, free: !!top && (el === top || el.contains(top)) }
})()`

/** The window's own Close button (the title bar's, not a dialog's). */
const TITLEBAR_CLOSE = `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close' && b.getBoundingClientRect().y < 50)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`

/** Middle-left of the first row of the songs table that shows this text (clear of the row's buttons). */
const rowWith = (text) => `(() => {
  const el = [...document.querySelectorAll('[role=grid] [role=row]')].find((r) => r.innerText.includes(${JSON.stringify(text)}))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.height ? { x: r.x + Math.min(200, r.width / 3), y: r.y + r.height / 2 } : null
})()`

/** The search box of the Add music page (its page has a section; the top bar has not). */
const ADD_BOX = `(() => {
  const el = [...document.querySelectorAll('input[aria-label=Search]')].find((e) => e.closest('section'))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
})()`

/** Ctrl+V outside a text field, as the page gets it: a paste event on the document that carries `text`. */
const pasteEvent = (text) => `document.dispatchEvent(Object.assign(new Event('paste', { bubbles: true }), { clipboardData: { getData: () => ${JSON.stringify(text)} } }))`

/** The songs table's rows, as text. */
const ROWS = "[...document.querySelectorAll('[role=grid] [role=row]')].map((r) => r.innerText)"

const SEARCH_BOX = `(() => {
  const el = document.querySelector('input[aria-label=Search]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
})()`

class Page {
  constructor(cdp) {
    this.cdp = cdp
  }

  text() {
    return this.cdp.evaluate('document.body.innerText')
  }

  waitText(text, timeout = 15000) {
    return this.cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, { timeout }).catch(() => {
      throw new Error(`the page never showed "${text}"`)
    })
  }

  waitDialog(text, timeout = 15000) {
    return this.cdp.waitFor(`(document.querySelector('[role=dialog]')?.innerText ?? '').includes(${JSON.stringify(text)})`, { timeout }).catch(() => {
      throw new Error(`no dialog showed "${text}"`)
    })
  }

  /** Clicks the control the user would: found by its label, not covered. A toast over it is dismissed first. */
  async press(label, { scope = 'dialog', timeout = 15000 } = {}) {
    const end = Date.now() + timeout
    for (;;) {
      const at = await this.cdp.evaluate(where(label, scope)).catch(() => null)
      if (at?.free) return this.cdp.click(at.x, at.y)
      if (at) await this.dismiss()
      if (Date.now() > end) throw new Error(at ? `"${label}" is covered by something that cannot be dismissed` : `no "${label}" button`)
      await sleep(200)
    }
  }

  /** The notification toasts (OneDrive's suggestion on a PC that has OneDrive) in the way. */
  async dismiss() {
    const at = await this.cdp.evaluate(where('Dismiss', 'page')).catch(() => null)
    if (at?.free) {
      await this.cdp.click(at.x, at.y)
      await sleep(400)
    }
  }

  /** The control is on the page (and not covered): the interface shows what the engine does. */
  seen(label, timeout = 15000) {
    return this.cdp.waitFor(where(label, 'transport'), { timeout }).catch(() => {
      throw new Error(`no "${label}" button on the page`)
    })
  }

  async clickAt(expression, what) {
    const at = await this.cdp.waitFor(expression, { timeout: 15000 }).catch(() => {
      throw new Error(`no ${what} on the page`)
    })
    await this.cdp.click(at.x, at.y)
  }

  invoke(command) {
    return this.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`)
  }

  status() {
    return this.invoke('player_status')
  }

  /** The engine's status, polled until `ok(status)`; the last one in the error. */
  async statusWhere(ok, what, timeout = 10000) {
    const end = Date.now() + timeout
    let last
    for (;;) {
      last = await this.status()
      if (ok(last)) return last
      if (Date.now() > end) throw new Error(`${what}: ${JSON.stringify(last)}`)
      await sleep(100)
    }
  }

  /** Answers the native folder picker with `folder`: its IPC request never reaches the app (CDP Fetch). The page gets what
   *  Tauri would send back, so the rest of the interface runs as it does when a person picks. */
  async answerFolderPicker(folder) {
    const { cdp } = this
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*ipc.localhost/plugin%3Adialog%7Copen*', requestStage: 'Request' }] })
    cdp.on('Fetch.requestPaused', (p) => {
      const reply =
        p.request.method === 'POST'
          ? cdp.send('Fetch.fulfillRequest', {
              requestId: p.requestId,
              responseCode: 200,
              responseHeaders: [
                { name: 'Tauri-Response', value: 'ok' },
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Access-Control-Allow-Origin', value: '*' },
                { name: 'Access-Control-Expose-Headers', value: 'Tauri-Response' },
              ],
              body: Buffer.from(JSON.stringify(folder)).toString('base64'),
            })
          : cdp.send('Fetch.continueRequest', { requestId: p.requestId })
      reply.catch(() => {})
    })
  }
}

// ---- One walk ----

/** Starts the app on its data and attaches to its page. `exited` resolves with the exit code when it ends. */
async function launch(mock, flags, errors) {
  const port = await freePort()
  const env = appEnv(process.env, { flags: `--remote-debugging-port=${port} --lang=en-US ${flags}`, mock: mock.url })
  const child = spawn(EXE, [], { env, stdio: 'ignore' })
  started.add(child.pid)
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.once('error', (e) => fail(`the app did not start: ${e.message}`))
  const early = exited.then((e) => {
    throw new Error(`the app ended before its window opened (exit ${e.code ?? e.signal})`)
  })
  // Only the race below reads it: once the window is there, the app ending is no news.
  early.catch(() => {})
  const target = await Promise.race([waitForPage(port, { match: (t) => t.type === 'page' && /localhost/.test(t.url), timeout: 90000 }), early])
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception'))
  await cdp.waitFor('document.body.innerText.length > 100', { timeout: 60000 })
  return { pid: child.pid, cdp, page: new Page(cdp), exited }
}

/** Closes the window by its Close button and waits for the app to end by itself. */
async function closeWindow(app) {
  await app.page.clickAt(TITLEBAR_CLOSE, 'Close button in the title bar')
  const ended = await Promise.race([app.exited, sleep(15000).then(() => null)])
  if (!ended) throw new Error('the app was still running 15 s after its window was closed')
  if (ended.code !== 0) throw new Error(`the app ended with exit code ${ended.code ?? ended.signal}, not 0`)
  started.delete(app.pid)
  app.cdp.close()
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** Deletes the data folders. WebView2's processes let go of a profile some seconds after the app is gone: tried again
 *  until they have. */
async function removeData(dirs, timeout = 40000) {
  const end = Date.now() + timeout
  for (const dir of dirs) {
    for (;;) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch (e) {
        if (Date.now() > end) throw new Error(`cannot delete ${dir} (${e.code}): a process still holds it`)
        await sleep(500)
      }
    }
  }
}

async function walk(o, dataDirs) {
  clearShots(o.shots)
  await removeData(dataDirs)
  writeDemo(DEMO)
  const mock = await startMock()
  const flags = browserArgs(readFileSync(path.join(ROOT, 'src-tauri', 'src', 'background.rs'), 'utf8'))
  let app
  const errors = []
  let current = 'start'
  const shot = async (name) => writeFileSync(path.join(o.shots, `${name}.png`), await app.cdp.screenshot())
  const t0 = Date.now()
  const step = async (name, run) => {
    current = name
    const at = Date.now()
    await run()
    console.log(`  ok  ${name.padEnd(11)} ${seconds(Date.now() - at)}`)
  }
  const watchdog = setTimeout(() => {
    console.error(`e2e: the walk ran over ${WATCHDOG_MS / 60000} minutes`)
    for (const pid of [...started]) stop(pid)
    process.exit(1)
  }, WATCHDOG_MS)

  try {
    await step('launch', async () => {
      app = await launch(mock, flags, errors)
      // A fresh profile: the welcome is the first thing, over the empty Home.
      await app.page.waitDialog('Welcome to Legato', 45000)
      await shot('1-welcome')
    })
    const { page } = app

    await step('welcome', async () => {
      await page.answerFolderPicker(DEMO)
      await page.press('Get started')
      // Home behind it says the same: the dialog's own second page is what is waited for.
      await page.waitDialog('Bring your music')
      await page.press('Add folder')
      await page.waitText(`${DEMO_SONGS.length} songs in your library`, 20000)
      const folders = await page.invoke('local_folders')
      if (folders.length !== 1 || path.resolve(folders[0]) !== path.resolve(DEMO)) throw new Error(`the library watches ${JSON.stringify(folders)}, not the demo folder`)
      await shot('2-library')
      await page.press('Start listening')
      await app.cdp.waitFor("!document.querySelector('[role=dialog]')", { timeout: 10000 })
    })

    await step('songs', async () => {
      await page.press('Songs')
      await app.cdp.waitFor("document.querySelectorAll('[role=grid] [role=row]').length > " + DEMO_SONGS.length, { timeout: 15000 })
      const rows = (await app.cdp.evaluate("[...document.querySelectorAll('[role=grid] [role=row]')].map((r) => r.innerText)")).map(flat)
      for (const s of DEMO_SONGS) if (!rows.some((r) => r.includes(s.title) && r.includes(s.artist))) throw new Error(`no row for ${s.artist} - ${s.title}: ${JSON.stringify(rows)}`)
      await shot('3-songs')
    })

    const first = DEMO_SONGS[0]
    await step('play', async () => {
      await page.clickAt(rowWith(first.title), `row of ${first.title}`)
      await page.seen('Pause')
      const a = await page.statusWhere((s) => !s.paused && s.positionMs > 300, 'the song never started')
      if (!a.path?.endsWith(first.file)) throw new Error(`playing ${a.path}, not ${first.file}`)
      const from = Date.now()
      await sleep(3000)
      const b = await page.status()
      const bad = pace(b.positionMs - a.positionMs, Date.now() - from)
      if (bad) throw new Error(bad)
      if (b.error) throw new Error(`the engine says: ${b.error}`)
      // The sound went through the live chain (a pure tone: its peak is the file's).
      const levels = await page.invoke('player_levels')
      if (!(levels.peak > 0.05)) throw new Error(`no sound in the live chain: ${JSON.stringify(levels)}`)
      await shot('4-playing')
    })

    await step('pause-play', async () => {
      await page.press('Pause', { scope: 'transport' })
      const paused = await page.statusWhere((s) => s.paused, 'Pause did not pause')
      await sleep(1000)
      const still = await page.status()
      if (Math.abs(still.positionMs - paused.positionMs) > 50) throw new Error(`the position moved while paused: ${paused.positionMs} to ${still.positionMs}`)
      await page.press('Play', { scope: 'transport' })
      const back = await page.statusWhere((s) => !s.paused, 'Play did not resume the song')
      if (back.positionMs < paused.positionMs - 100) throw new Error(`Play started the song over: ${paused.positionMs} to ${back.positionMs}`)
      // The button says so too.
      await page.seen('Pause')
      await sleep(1500)
      const later = await page.status()
      if (later.positionMs < back.positionMs + 800) throw new Error(`the song did not play on after Play: ${back.positionMs} to ${later.positionMs}`)
    })

    // The mock has no lyrics: the screen opens full window with its calm message, and Esc brings the page back.
    await step('karaoke', async () => {
      const key = (code) => page.cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true }))`)
      const open = "document.querySelector('[role=dialog][aria-label=Karaoke]')"
      await key('KeyK')
      await page.cdp.waitFor(`${open} && ${open}.innerText.includes('No lyrics found')`, { timeout: 15000 }).catch(() => {
        throw new Error('K did not open Karaoke with its message')
      })
      await key('Escape')
      await page.cdp.waitFor(`!${open}`, { timeout: 5000 }).catch(() => {
        throw new Error('Esc did not close Karaoke')
      })
      // The window comes back out of full screen before the walk goes on.
      await sleep(800)
    })

    await step('search', async () => {
      const query = 'paper lanterns'
      await page.press('Home')
      await page.clickAt(SEARCH_BOX, 'search box')
      await app.cdp.send('Input.insertText', { text: query })
      await page.waitText(`${query} glass harbour`)
      await app.cdp.enter()
      await page.waitText('Tidewater')
      const tabs = (await app.cdp.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.innerText)")).map(flat)
      for (const want of ['YouTube Music 2', 'YouTube 3', 'Apple Music 2']) if (!tabs.includes(want)) throw new Error(`no "${want}" among ${JSON.stringify(tabs)}`)
      const buttons = await app.cdp.evaluate("[...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || '')")
      for (const title of ['Paper Lanterns', 'Night Bus', 'Tidewater']) if (!buttons.includes(`Play ${title}`)) throw new Error(`no result "${title}"`)
      // Not music (a tutorial): kept out of the list until asked.
      if ((await page.text()).includes('How to fold paper lanterns')) throw new Error('a video that is not music shows among the results')
      // What the app asked, and of whom: the mock saw each service once, with the typed text.
      const asked = {
        youtube: mock.to('POST', '/youtube/search')[0]?.body?.query,
        ytmusic: mock.to('POST', '/ytmusic/search')[0]?.body?.query,
        apple: mock.to('GET', '/itunes/search')[0]?.query?.term,
        suggest: mock.to('GET', '/suggest')[0]?.query?.q,
      }
      for (const [who, got] of Object.entries(asked)) if (got !== query) throw new Error(`${who} was asked ${JSON.stringify(got)}, not ${JSON.stringify(query)}`)
      const stray = mock.unexpected()
      if (stray.length) throw new Error(`calls the mock has no answer for: ${stray.map((r) => `${r.method} ${r.path}`).join(', ')}`)
      // One song at a time: the local one plays on under the results.
      const now = await page.status()
      if (now.paused || !now.path?.endsWith(first.file)) throw new Error(`the search stopped or replaced the song: ${JSON.stringify(now)}`)
      await shot('5-search')
    })

    await step('links', async () => {
      const waitText = (text) => page.waitText(text, 20000)
      // A Deezer playlist link typed in Add music's box: two songs read, one of them on YouTube.
      await page.press('Add music')
      await page.clickAt(ADD_BOX, 'Add music search box')
      await app.cdp.send('Input.insertText', { text: DEEZER_LINK })
      await app.cdp.enter()
      await waitText('Importing from Deezer… 0 of 2')
      await waitText('Imported “Soirée Hits 2026 : La Playlist Certifiée”: 1 of 2 songs found')
      await waitText('Not found: Lykke Li – I Follow Rivers (The Magician Remix)')
      await waitText('Only 2 of the 153 songs came in')
      await app.cdp.waitFor(`${ROWS}.some((r) => r.includes("Can't Hold Us"))`, { timeout: 10000 }).catch(() => {
        throw new Error('the new playlist does not list its song')
      })
      const rows = await app.cdp.evaluate(ROWS)
      if (rows.some((r) => r.includes('I Follow Rivers'))) throw new Error(`the playlist lists a song that was not found: ${JSON.stringify(rows)}`)
      if (!(await page.text()).includes('Soirée Hits 2026')) throw new Error('the playlist is not in the page')
      if (mock.to('GET', '/deezer/playlist/2477790684').length !== 1) throw new Error('the Deezer playlist was not read once')
      await shot('5-imported')
      // An Apple Music album link pasted anywhere (Ctrl+V): Cancel ends the searches, nothing is made.
      await app.cdp.evaluate(pasteEvent(APPLE_LINK))
      await waitText('Importing from Apple Music… 0 of 2')
      await page.press('Cancel', { scope: 'page' })
      await waitText('Import canceled')
      if ((await page.text()).includes('In Between Dreams')) throw new Error('a canceled import made a playlist')
      // Again, left to finish: the first one freed the import for it.
      await app.cdp.evaluate(pasteEvent(APPLE_LINK))
      await waitText('Imported “In Between Dreams (Bonus Track Version)”: 1 of 2 songs found')
      await app.cdp.waitFor(`${ROWS}.some((r) => r.includes('Better Together'))`, { timeout: 10000 }).catch(() => {
        throw new Error('the album playlist does not list its song')
      })
      const stray = mock.unexpected()
      if (stray.length) throw new Error(`calls the mock has no answer for: ${stray.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    })

    await step('quit', async () => {
      await page.press('Settings')
      await page.press('Keep running in the notification area')
      await app.cdp.waitFor(`document.querySelector('[aria-label="Keep running in the notification area"]')?.getAttribute('aria-checked') === 'false'`, { timeout: 5000 })
      // Saved, not just shown: the window's close reads it from the library.
      await app.cdp.waitFor("window.__TAURI_INTERNALS__.invoke('load_settings').then((s) => s.closeToTray === false)", { timeout: 10000 })
      await shot('6-settings')
      await closeWindow(app)
    })

    await step('relaunch', async () => {
      app = await launch(mock, flags, errors)
      // The count fills in once the library is read: a first look says 0. 3 demo songs + the 2 the imports found.
      await app.cdp.waitFor(String.raw`/All your songs\s*·\s*5\b/.test(document.body.innerText)`, { timeout: 15000 }).catch(() => {
        throw new Error('the library lost its songs')
      })
      // The welcome would show at once; give it a moment.
      await sleep(1500)
      if (await app.cdp.evaluate("!!document.querySelector('[role=dialog]')")) throw new Error('the welcome came back on a library that has been through it')
      await shot('7-relaunch')
      await closeWindow(app)
    })

    const stray = mock.unexpected()
    if (stray.length) throw new Error(`calls the mock has no answer for: ${stray.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    for (const e of errors) console.log(`  note page error: ${flat(e).slice(0, 200)}`)
    return Date.now() - t0
  } catch (e) {
    console.log(`  FAIL ${current}: ${e.message}`)
    await explain(o, app, mock, errors, current, e, dataDirs)
    throw e
  } finally {
    clearTimeout(watchdog)
    app?.cdp.close()
    for (const pid of [...started]) stop(pid)
    await mock.close()
  }
}

/** What a failure leaves for whoever reads it (a CI artifact): the window, the step, what the page and the mock saw. */
async function explain(o, app, mock, errors, step, error, dataDirs) {
  const lines = [`step: ${step}`, `error: ${error.stack ?? error}`]
  try {
    if (app) {
      writeFileSync(path.join(o.shots, `FAIL-${step}.png`), await app.cdp.screenshot())
      lines.push('', 'page text:', (await app.page.text()).slice(0, 4000), '', `player: ${JSON.stringify(await app.page.status().catch(() => null))}`)
    }
  } catch (e) {
    lines.push('', `no window to look at: ${e.message}`)
  }
  lines.push('', 'page errors:', ...errors.map(flat))
  lines.push('', 'mock saw:', ...mock.requests.map((r) => `${r.method} ${r.path} ${JSON.stringify(r.query)}`))
  const log = path.join(dataDirs[0], 'diagnostics.log')
  if (existsSync(log)) {
    copyFileSync(log, path.join(o.shots, 'diagnostics.log'))
    lines.push('', 'diagnostics log, tail:', ...readFileSync(log, 'utf8').trimEnd().split('\n').slice(-30))
  }
  writeFileSync(path.join(o.shots, 'failure.txt'), `${lines.join('\n')}\n`)
  console.log(`  what was left: ${o.shots}`)
}

/** The diagnostics log of a run that passed: no panic in it, and the page (not the 8 s timer) started the deferred work. */
function checkLog(dataDir) {
  const log = path.join(dataDir, 'diagnostics.log')
  if (!existsSync(log)) return
  const lines = readFileSync(log, 'utf8').split('\n')
  const bad = lines.filter((l) => /\bpanic/i.test(l))
  if (bad.length) throw new Error(`the diagnostics log holds a panic: ${bad[0]}`)
  const errors = lines.filter((l) => /\sERROR\s/.test(l))
  const starts = deferredStarts(lines.join('\n'))
  if (starts.timer) throw new Error(`the deferred work was started by the 8 s timer ${starts.timer} time(s): the page did not say ready in time`)
  if (!starts.ready) throw new Error('the diagnostics log never says the page started the deferred work')
  if (errors.length) console.log(`  note ${errors.length} error line(s) in the diagnostics log, first: ${errors[0].slice(0, 200)}`)
}

async function main() {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    fail(e.message)
  }
  if (process.platform !== 'win32') fail('the smoke test drives WebView2: Windows only')
  const conf = JSON.parse(readFileSync(CONF, 'utf8'))
  const dataDirs = e2eFolders(conf.identifier, process.env.APPDATA, process.env.LOCALAPPDATA)
  const alone = running()
  if (alone.length) fail(`a smoke-test app already runs (PID ${alone.join(', ')}): stop it first, by PID`)

  ensureBuild(o)
  if (o.buildOnly) return
  const bytes = readFileSync(EXE)
  if (!carriesId(bytes, conf.identifier)) fail(`${EXE} was not built for ${conf.identifier}: run without --skip-build`)
  if (!carriesId(bytes, FEATURE_MARK)) fail(`${EXE} was not built with the e2e feature: it would reach the real network. Run without --skip-build`)

  process.on('exit', () => {
    for (const pid of [...started]) stop(pid)
  })
  process.on('SIGINT', () => process.exit(130))
  try {
    for (let n = 1; n <= o.repeat; n++) {
      console.log(o.repeat > 1 ? `walk ${n} of ${o.repeat}` : 'walk')
      const took = await walk(o, dataDirs)
      checkLog(dataDirs[0])
      console.log(`  passed in ${seconds(took)}`)
    }
  } catch (e) {
    fail(e.message)
  } finally {
    if (!o.keep) await removeData(dataDirs).catch((e) => console.log(`note: ${e.message}`))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
