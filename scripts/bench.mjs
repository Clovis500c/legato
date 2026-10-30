// pnpm bench: what Legato costs on a 10 000-song library. Builds the release app under its own identifier
// (src-tauri/tauri.bench.conf.json: no bundle, no signing, own folders, never the installed app's), fills a fresh data
// folder (crates/core/examples/bench_data.rs), starts it and reads, through the WebView2 DevTools port (scripts/cdp.mjs)
// and Windows' own counters:
//   start   process spawn to window shown (a PowerShell watcher), and to first contentful paint (performance entries)
//   RAM     private working set (Task Manager's Details tab) of legato-bench.exe plus its own msedgewebview2.exe
//           descendants, walked from its PID: the installed app has its own, never counted
//   CPU     the same processes' CPU time over a window, as % of the whole PC (Task Manager's way) and of one core
// Paused on screen, then a local song for a minute, then 10 minutes in the tray (close = hide), paused. YouTube is not
// measured: its player needs the network and lives in WebView2's page. The row goes to docs/performance.md.
//
//   pnpm bench                full run, about 20 minutes, row saved
//   pnpm bench --quick        short windows (15 s, 1 min in the tray), not saved unless --save
//   --skip-build              keep target/bench/legato-bench.exe when its inputs have not changed
//   --build-only              build, then stop
//   --save | --no-save        save the row (default: full runs) or not
//   --keep                    leave the bench data folders after the run
//   --note "text"             goes in the Notes cell
//   --shots <dir>             a PNG of the window at each step

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Cdp, sleep, waitForPage } from './cdp.mjs'
import { browserArgs, carriesId, freePort, inputsHash, isBuildInput } from './guest.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONF = path.join(ROOT, 'src-tauri', 'tauri.bench.conf.json')
const EXE = path.join(ROOT, 'target', 'bench', 'legato-bench.exe')
const BUILT = path.join(ROOT, 'target', 'release', 'legato.exe')
const PERF = path.join(ROOT, 'docs', 'performance.md')
export const BENCH_ID = 'app.legato.desktop.bench'
const SONGS = 10_000
const MB = 1024 * 1024

// ---- Pure parts (scripts/bench.test.ts) ----

export function parseArgs(argv) {
  const o = { quick: false, skipBuild: false, buildOnly: false, save: undefined, keep: false, note: '', shots: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quick') o.quick = true
    else if (a === '--skip-build') o.skipBuild = true
    else if (a === '--build-only') o.buildOnly = true
    else if (a === '--save') o.save = true
    else if (a === '--no-save') o.save = false
    else if (a === '--keep') o.keep = true
    else if (a === '--note') o.note = argv[++i] ?? ''
    else if (a === '--shots') o.shots = argv[++i] ?? ''
    else throw new Error(`unknown option ${a} (the top of scripts/bench.mjs lists them)`)
  }
  // Short runs are not numbers of record.
  o.save ??= !o.quick
  return o
}

/** Seconds per step. `trace`: RAM looked at while in the tray (the app suspends its page after 5 min hidden and silent). */
export function plan(quick) {
  return quick ? { settle: 5, idle: 15, play: 15, tray: 60, trace: [30] } : { settle: 15, idle: 60, play: 60, tray: 600, trace: [60, 240, 360] }
}

/** The two folders this script may delete. Any other identifier: refused, so the installed app's data is out of reach. */
export function benchFolders(id, appData, localAppData) {
  if (id !== BENCH_ID) throw new Error(`the bench identifier is ${BENCH_ID}, not ${id}`)
  for (const base of [appData, localAppData]) if (!base || !path.win32.isAbsolute(base)) throw new Error('APPDATA and LOCALAPPDATA must be set')
  return [path.win32.join(appData, id), path.win32.join(localAppData, id)]
}

/** The page of third-party notices a release build needs (`src-tauri/build.rs` stops without it): text of the file, or null
 *  when there is none. The placeholder a dev build writes does not count. */
export function noticesReady(html) {
  return typeof html === 'string' && !html.includes('<meta name="placeholder">')
}

// Shared with `pnpm e2e` (scripts/guest.mjs); the tests read them from here.
export { browserArgs, carriesId, isBuildInput }

/** RAM of one sample in MB: private working sets of the WebView2 processes and of the rest of the tree. */
export function memory(sample) {
  let app = 0
  let web = 0
  for (const p of sample.procs) {
    if (/^msedgewebview2\.exe$/i.test(p.name)) web += p.wsp ?? 0
    else app += p.wsp ?? 0
  }
  return { app: app / MB, web: web / MB, total: (app + web) / MB, processes: sample.procs.length }
}

/** CPU seconds each process of the tree used between the first and the last sample (100 ns units in). A process born in
 *  between counts from zero; one gone before the last sample counts up to its last sight. */
export function cpuByProcess(samples) {
  const seen = new Map()
  samples.forEach((s, i) => {
    for (const p of s.procs) {
      const row = seen.get(p.pid) ?? { pid: p.pid, name: p.name, kind: p.kind ?? '', first: i === 0 ? p.cpu : 0, last: 0 }
      row.last = p.cpu
      seen.set(p.pid, row)
    }
  })
  return [...seen.values()].map((r) => ({ pid: r.pid, name: r.name, kind: r.kind, seconds: Math.max(0, r.last - r.first) / 1e7 }))
}

export const cpuSeconds = (samples) => cpuByProcess(samples).reduce((sum, p) => sum + p.seconds, 0)

/** CPU seconds over wall seconds, as % of one core and as % of the whole PC. */
export function share(cpu, wall, threads) {
  const core = (100 * cpu) / wall
  return { core, pc: core / threads }
}

/** One measured window: samples taken over time → CPU share, the three busiest processes, RAM at the end, RAM peak, PC load seen. */
export function summarize(samples, threads) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const wall = (last.t - first.t) / 1000
  const loads = samples.map((s) => s.load).filter((n) => typeof n === 'number')
  return {
    seconds: wall,
    cpu: share(cpuSeconds(samples), wall, threads),
    hot: cpuByProcess(samples)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 3)
      .map((p) => ({ label: p.kind || p.name, core: (100 * p.seconds) / wall })),
    ram: memory(last),
    peak: Math.max(...samples.map((s) => memory(s).total)),
    pcLoad: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
  }
}

/** The line docs/performance.md gets (columns as its header). */
export function tableRow(r) {
  const s = (ms) => (ms / 1000).toFixed(2)
  const mb = (n) => Math.round(n)
  const pc = (n) => n.toFixed(1)
  return `| ${[
    r.date,
    r.version,
    r.pc,
    `${s(r.cold.shown)} / ${s(r.restart.shown)} s`,
    `${s(r.cold.fcp)} / ${s(r.restart.fcp)} s`,
    `${mb(r.idle.ram.total)} / ${mb(r.play.ram.total)} / ${mb(r.tray.ram.total)}`,
    `${pc(r.idle.cpu.pc)} / ${pc(r.play.cpu.pc)} / ${pc(r.tray.cpu.pc)}`,
    r.note,
  ].join(' | ')} |`
}

/** The doc with one more row at the end of its last table. */
export function withRow(text, row) {
  const body = text.trimEnd()
  if (!body.split('\n').pop().startsWith('|')) throw new Error('docs/performance.md must end with the results table')
  return `${body}\n${row}\n`
}

// ---- The run ----

const fail = (message) => {
  console.error(`bench: ${message}`)
  process.exit(1)
}

const started = new Set()

/** Stops a process this script started (and its children), by PID, after checking the PID still is our exe. */
function stop(pid) {
  const name = path.basename(EXE)
  const listed = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  if (listed.toLowerCase().includes(`"${name}"`)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  started.delete(pid)
}

function runningBench() {
  const listed = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(EXE)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  return listed
    .split('\n')
    .filter((l) => l.toLowerCase().startsWith(`"${path.basename(EXE).toLowerCase()}"`))
    .map((l) => l.split('","')[1])
}

/** `tauri build --no-bundle` under the bench identifier, then the exe copied to its own name and folder: only this script
 *  writes target/bench, so what runs there never is a normal build made later by `pnpm build`. */
function ensureBuild(o) {
  const stamp = `${EXE}.inputs`
  const hash = inputsHash(ROOT)
  if (o.skipBuild && existsSync(EXE) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) {
    console.log('build: inputs unchanged, reusing target/bench/legato-bench.exe')
    return
  }
  // The release profile stops in build.rs without the notices; only `pnpm notices` writes them (git-ignored, cargo-about).
  // Said now, not after minutes of compiling: a fresh clone, or a PC that only ever ran `pnpm dev`, has none.
  const notices = path.join(ROOT, 'src-tauri', 'third-party-licenses.html')
  if (!noticesReady(existsSync(notices) ? readFileSync(notices, 'utf8') : null)) {
    fail('src-tauri/third-party-licenses.html is missing (or only the dev placeholder): the release build stops without it. Run `pnpm notices` once (needs cargo-about, docs/licenses.md), then pnpm bench again')
  }
  const fresh =existsSync(EXE) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash
  console.log(`build: tauri build --no-bundle (release, LTO: minutes)${fresh ? ' - the inputs have not changed, --skip-build would save them' : ''}`)
  const built = spawnSync('pnpm tauri build --no-bundle --config src-tauri/tauri.bench.conf.json', { cwd: ROOT, stdio: 'inherit', shell: true })
  if (built.status !== 0) fail('the build failed')
  mkdirSync(path.dirname(EXE), { recursive: true })
  copyFileSync(BUILT, EXE)
  writeFileSync(stamp, hash)
}

/** The data folder: library of 10 000 local songs, playlists, plays, and the silent files they point at. */
function freshData(dataDir, localDir, keep) {
  for (const dir of [dataDir, localDir]) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  console.log(`data: ${SONGS} songs in ${dataDir}`)
  const made = spawnSync('cargo', ['run', '-q', '-p', 'music-core', '--example', 'bench_data', '--', dataDir, String(SONGS)], { cwd: ROOT, stdio: 'inherit' })
  if (made.status !== 0) fail('the data generator failed')
  return () => {
    if (!keep) for (const dir of [dataDir, localDir]) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

// One PowerShell for the whole run, asked one line at a time (stdin), answering one JSON line each. Windows PowerShell 5.1
// ships with Windows; -EncodedCommand needs no script file and no execution policy.
const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
  delegate bool Visit(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit v, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  // The PC and the screen stay awake while this helper lives (a media player's request, gone with the process): a
  // screen that turned off in the middle of a window would measure nothing like use.
  public static void KeepAwake() { SetThreadExecutionState(0x80000003); }
  // The visible top-level window of class cls that process pid owns, 0 when none. Not MainWindowHandle: the
  // single-instance plugin's window is visible too, and takes over once the main window is hidden.
  public static long Find(uint pid, string cls) {
    long found = 0;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      StringBuilder name = new StringBuilder(256);
      GetClassName(h, name, 256);
      if (name.ToString() != cls) return true;
      found = h.ToInt64();
      return false;
    }, IntPtr.Zero);
    return found;
  }
  // WM_CLOSE, what the window's close button sends.
  public static bool Close(long h) { return PostMessage(new IntPtr(h), 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@
$MainClass = 'Tauri Window'
[Win]::KeepAwake()
function Now { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Send($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 6)); [Console]::Out.Flush() }
function Tree($root) {
  $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, CreationDate, KernelModeTime, UserModeTime)
  $kids = @{}
  $byId = @{}
  foreach ($q in $all) {
    $byId[[int]$q.ProcessId] = $q
    $k = [int]$q.ParentProcessId
    if (-not $kids.ContainsKey($k)) { $kids[$k] = New-Object System.Collections.ArrayList }
    [void]$kids[$k].Add($q)
  }
  $out = New-Object System.Collections.ArrayList
  if ($byId.ContainsKey($root)) { [void]$out.Add($byId[$root]) }
  for ($i = 0; $i -lt $out.Count; $i++) {
    $p = $out[$i]
    $id = [int]$p.ProcessId
    if ($kids.ContainsKey($id)) {
      # A child is born after its parent: a reused parent PID does not adopt old orphans.
      foreach ($c in $kids[$id]) { if ($c.CreationDate -ge $p.CreationDate) { [void]$out.Add($c) } }
    }
  }
  return ,$out
}
Send @{ ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ', 2)
  $cmd = $parts[0]
  $arg = ''
  if ($parts.Length -gt 1) { $arg = $parts[1] }
  try {
    switch ($cmd) {
      'watch' {
        $p = [Diagnostics.Process]::GetProcessById([int]$arg)
        $at = $null
        while (-not $p.HasExited) {
          if ([Win]::Find([uint32]$arg, $MainClass) -ne 0) { $at = Now; break }
          Start-Sleep -Milliseconds 2
        }
        Send @{ shown = $at }
      }
      'visible' {
        Send @{ visible = ([Win]::Find([uint32]$arg, $MainClass) -ne 0) }
      }
      'close' {
        $h = [Win]::Find([uint32]$arg, $MainClass)
        $ok = $false
        if ($h -ne 0) { $ok = [Win]::Close($h) }
        Send @{ closed = $ok }
      }
      'sample' {
        $t = Now
        $tree = Tree ([int]$arg)
        $perf = @{}
        if ($tree.Count -gt 0) {
          $filter = (@($tree | ForEach-Object { 'IDProcess=' + [int]$_.ProcessId }) -join ' OR ')
          foreach ($f in @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter)) { $perf[[int]$f.IDProcess] = [int64]$f.WorkingSetPrivate }
        }
        $load = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        $procs = @(foreach ($p in $tree) {
          $id = [int]$p.ProcessId
          $w = $null
          if ($perf.ContainsKey($id)) { $w = $perf[$id] }
          # WebView2: browser, renderer, gpu-process, utility...
          $kind = ''
          if ($p.Name -eq 'msedgewebview2.exe') {
            $kind = 'browser'
            if ($p.CommandLine -match '--type=([a-z-]+)') { $kind = $Matches[1] }
          }
          @{ pid = $id; name = $p.Name; kind = $kind; cpu = ([int64]$p.KernelModeTime + [int64]$p.UserModeTime); wsp = $w }
        })
        Send @{ t = $t; load = $load; procs = $procs }
      }
      default { Send @{ error = ('unknown command ' + $cmd) } }
    }
  } catch {
    Send @{ error = $_.Exception.Message }
  }
}
`

class Helper {
  #proc
  #waiting = []
  #buffer = ''

  constructor() {
    const encoded = Buffer.from(HELPER, 'utf16le').toString('base64')
    this.#proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.#proc.stdout.setEncoding('utf8')
    this.#proc.stdout.on('data', (chunk) => {
      this.#buffer += chunk
      for (let nl = this.#buffer.indexOf('\n'); nl >= 0; nl = this.#buffer.indexOf('\n')) {
        const line = this.#buffer.slice(0, nl).trim()
        this.#buffer = this.#buffer.slice(nl + 1)
        if (!line) continue
        const waiter = this.#waiting.shift()
        const msg = JSON.parse(line)
        if (msg.error) waiter?.reject(new Error(`PowerShell: ${msg.error}`))
        else waiter?.resolve(msg)
      }
    })
    this.#proc.stderr.resume()
    // A write to a helper that died: the exit below rejects whoever waits.
    this.#proc.stdin.on('error', () => {})
    this.#proc.on('exit', () => {
      for (const w of this.#waiting.splice(0)) w.reject(new Error('the PowerShell helper stopped'))
    })
  }

  static async start() {
    const h = new Helper()
    await new Promise((resolve, reject) => h.#waiting.push({ resolve, reject }))
    await h.sample(process.pid)
    return h
  }

  call(line) {
    return new Promise((resolve, reject) => {
      this.#waiting.push({ resolve, reject })
      this.#proc.stdin.write(`${line}\n`)
    })
  }

  sample(pid) {
    return this.call(`sample ${pid}`)
  }

  close() {
    this.#proc.stdin.end()
    this.#proc.kill()
  }
}

/** Page pixels of the first button or link that carries this text (or aria-label), null when there is none. */
const where = (label) => `(() => {
  const want = ${JSON.stringify(label)}
  const el = [...document.querySelectorAll('button, a, [role=button]')].find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().split('\\n')[0].trim() === want)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
})()`

/** Left part of the first song row of the list (clear of its buttons and links). */
const FIRST_ROW = `(() => {
  const el = document.querySelector('[role=grid] [role=row][aria-selected]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.height ? { x: r.x + Math.min(200, r.width / 3), y: r.y + r.height / 2 } : null
})()`

async function press(cdp, label, opts) {
  const p = await cdp.waitFor(where(label), opts)
  await cdp.click(p.x, p.y)
}

/** Starts the app and reads its start: window shown (PowerShell watcher) and paints (page entries), ms after spawn. */
async function launch(helper, args) {
  const port = await freePort()
  const flags = `--remote-debugging-port=${port} --lang=en-US ${args}`
  const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: flags }
  const t0 = Date.now()
  const child = spawn(EXE, [], { env, stdio: 'ignore' })
  child.on('error', (e) => fail(`the bench app did not start: ${e.message}`))
  started.add(child.pid)
  const watching = helper.call(`watch ${child.pid}`)
  const target = await waitForPage(port, { match: (t) => t.type === 'page' && /localhost/.test(t.url), timeout: 60000 })
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  const paint = await cdp.waitFor(
    `(() => { const c = performance.getEntriesByName('first-contentful-paint')[0]; const p = performance.getEntriesByName('first-paint')[0]; return c ? { origin: performance.timeOrigin, fcp: c.startTime, fp: p ? p.startTime : c.startTime } : null })()`,
    { timeout: 60000, every: 50 },
  )
  const { shown } = await watching
  if (!shown) fail('the bench app closed before showing its window')
  return { pid: child.pid, cdp, shown: shown - t0, fp: paint.origin + paint.fp - t0, fcp: paint.origin + paint.fcp - t0 }
}

function alive(pid) {
  try {
    return process.kill(pid, 0)
  } catch {
    return false
  }
}

async function quit(app) {
  app.cdp.close()
  stop(app.pid)
  for (let i = 0; i < 100 && alive(app.pid); i++) await sleep(100)
  // Its WebView2 children release the profile a moment later.
  await sleep(1000)
}

/** Samples the tree for `seconds` (every 10 s, 5 s in short windows), ends with RAM and CPU of that window. Each sample
 *  costs WMI a second of CPU: the PC load in the notes includes it. */
async function measure(helper, pid, seconds, threads) {
  const every = seconds > 30 ? 10000 : 5000
  const samples = [await helper.sample(pid)]
  const end = samples[0].t + seconds * 1000
  while (samples[samples.length - 1].t < end) {
    await sleep(Math.min(every, Math.max(0, end - Date.now() - 1000)))
    samples.push(await helper.sample(pid))
  }
  return summarize(samples, threads)
}

async function main() {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    fail(e.message)
  }
  if (process.platform !== 'win32') fail('pnpm bench measures WebView2 and Windows counters: Windows only')
  const conf = JSON.parse(readFileSync(CONF, 'utf8'))
  const [dataDir, localDir] = benchFolders(conf.identifier, process.env.APPDATA, process.env.LOCALAPPDATA)
  const alone = runningBench()
  if (alone.length) fail(`a bench app already runs (PID ${alone.join(', ')}): stop it first, by PID`)

  ensureBuild(o)
  if (o.buildOnly) return
  if (!carriesId(readFileSync(EXE), conf.identifier)) fail(`${EXE} was not built for ${conf.identifier}: run without --skip-build`)

  const t = plan(o.quick)
  const threads = os.cpus().length
  const args = browserArgs(readFileSync(path.join(ROOT, 'src-tauri', 'src', 'background.rs'), 'utf8'))
  const cleanData = freshData(dataDir, localDir, o.keep)
  const helper = await Helper.start()
  const shot = async (app, name) => {
    if (!o.shots) return
    mkdirSync(o.shots, { recursive: true })
    writeFileSync(path.join(o.shots, `${name}.png`), await app.cdp.screenshot())
  }
  const cleanup = () => {
    for (const pid of [...started]) stop(pid)
    helper.close()
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => process.exit(130))

  try {
    console.log(`run: ${o.quick ? 'quick' : 'full'}, ${threads} threads`)
    const app = await launch(helper, args)
    const cold = { shown: app.shown, fp: app.fp, fcp: app.fcp }
    console.log(`cold start: window ${(cold.shown / 1000).toFixed(2)} s, first contentful paint ${(cold.fcp / 1000).toFixed(2)} s`)
    await app.cdp.waitFor(`document.body.innerText.length > 200`, { timeout: 60000 })
    await shot(app, '1-started')
    await press(app.cdp, 'Songs')
    await app.cdp.waitFor(FIRST_ROW, { timeout: 30000 })
    // The OneDrive suggestion (any PC with OneDrive): answered, like a user's settled session.
    const toast = await app.cdp.evaluate(where('Dismiss'))
    if (toast) await app.cdp.click(toast.x, toast.y)
    await sleep(t.settle * 1000)
    await shot(app, '2-songs')

    console.log(`idle: paused on the Songs page, ${t.idle} s`)
    const idle = await measure(helper, app.pid, t.idle, threads)

    console.log(`playing: a local song, ${t.play} s`)
    const row = await app.cdp.waitFor(FIRST_ROW)
    await app.cdp.click(row.x, row.y)
    await app.cdp.waitFor(where('Pause'), { timeout: 15000 })
    await sleep(5000)
    await shot(app, '3-playing')
    const play = await measure(helper, app.pid, t.play, threads)
    if (!(await app.cdp.evaluate(where('Pause')))) fail('the music stopped during the playing window')

    console.log(`tray: paused, window closed to the tray, ${t.tray} s`)
    await press(app.cdp, 'Pause')
    await app.cdp.waitFor(`!${where('Pause')}`, { timeout: 10000 })
    if (!(await helper.call(`close ${app.pid}`)).closed) fail('no window to close')
    await sleep(1500)
    if ((await helper.call(`visible ${app.pid}`)).visible) fail('the window did not go to the tray')
    const tray0 = Date.now()
    const trace = []
    for (const at of t.trace) {
      await sleep(Math.max(0, tray0 + at * 1000 - Date.now()))
      trace.push({ at, ram: memory(await helper.sample(app.pid)) })
    }
    await sleep(Math.max(0, tray0 + (t.tray - t.idle) * 1000 - Date.now()))
    const tray = await measure(helper, app.pid, t.idle, threads)
    await quit(app)

    console.log('restart: the profile exists now')
    const again = await launch(helper, args)
    const restart = { shown: again.shown, fp: again.fp, fcp: again.fcp }
    await quit(again)

    const pcName = os.cpus()[0].model.replace(/\((R|TM)\)/g, '').replace(/^(AMD|Intel)\s+/i, '').replace(/\s+/g, ' ').trim()
    const build = Number(os.release().split('.')[2])
    const result = {
      date: new Date().toISOString().slice(0, 10),
      version: `${JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version} (${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()})`,
      pc: `${pcName}, ${threads} threads, ${Math.round(os.totalmem() / 1024 ** 3)} GB, Windows ${build >= 22000 ? 11 : 10} (${build})`,
      cold,
      restart,
      idle,
      play,
      tray,
      trace,
      note: [o.quick ? 'quick run' : null, 'other apps were running', `PC load ${Math.round(idle.pcLoad ?? 0)} / ${Math.round(play.pcLoad ?? 0)} / ${Math.round(tray.pcLoad ?? 0)} %`, o.note || null].filter(Boolean).join('; '),
    }
    print(result)
    if (o.save) {
      writeFileSync(PERF, withRow(readFileSync(PERF, 'utf8'), tableRow(result)))
      console.log(`saved: a row in docs/performance.md`)
    } else {
      console.log('not saved (--save adds the row to docs/performance.md)')
    }
  } finally {
    cleanup()
    process.off('exit', cleanup)
    cleanData()
  }
}

function print(r) {
  const s = (ms) => `${(ms / 1000).toFixed(2)} s`
  const row = (name, w) => `${name.padEnd(34)} ${`${Math.round(w.ram.total)} MB`.padStart(8)} ${`(app ${Math.round(w.ram.app)}, WebView2 ${Math.round(w.ram.web)}, ${w.ram.processes} processes)`.padEnd(46)} ${`${w.cpu.pc.toFixed(2)} %`.padStart(8)} of the PC ${`(${w.cpu.core.toFixed(1)} % of a core)`.padStart(20)}`
  console.log(`\n${r.version}, ${r.pc}\n`)
  console.log(`${''.padEnd(34)} ${'window shown'.padStart(13)} ${'first paint'.padStart(12)}`)
  console.log(`${'cold start (new profile)'.padEnd(34)} ${s(r.cold.shown).padStart(13)} ${s(r.cold.fcp).padStart(12)}`)
  console.log(`${'restart (profile kept)'.padEnd(34)} ${s(r.restart.shown).padStart(13)} ${s(r.restart.fcp).padStart(12)}\n`)
  const hot = (w) => `${''.padEnd(34)} busiest, % of a core: ${w.hot.map((p) => `${p.label} ${p.core.toFixed(1)}`).join(', ')}`
  console.log(row('paused, on screen', r.idle))
  console.log(hot(r.idle))
  console.log(row(`playing a local song, ${Math.round(r.play.seconds)} s`, r.play))
  console.log(hot(r.play))
  console.log(row(`in the tray, paused, at the end`, r.tray))
  console.log(hot(r.tray))
  for (const x of r.trace) console.log(`  tray after ${x.at} s: ${Math.round(x.ram.total)} MB (WebView2 ${Math.round(x.ram.web)})`)
  console.log(`\n${r.note}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => fail(e.stack ?? String(e)))
}
