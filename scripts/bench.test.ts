import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BENCH_ID, benchFolders, browserArgs, carriesId, cpuSeconds, isBuildInput, memory, parseArgs, plan, share, summarize, tableRow, withRow } from './bench.mjs'

const MB = 1024 * 1024
const proc = (pid: number, name: string, cpu: number, wsp: number | null) => ({ pid, name, cpu, wsp })
const sample = (t: number, procs: ReturnType<typeof proc>[], load: number | null = null) => ({ t, load, procs })

describe('bench options', () => {
  it('saves full runs and not quick ones, unless told', () => {
    expect(parseArgs([])).toMatchObject({ quick: false, save: true, skipBuild: false })
    expect(parseArgs(['--quick'])).toMatchObject({ quick: true, save: false })
    expect(parseArgs(['--quick', '--save']).save).toBe(true)
    expect(parseArgs(['--no-save']).save).toBe(false)
    expect(parseArgs(['--skip-build', '--keep', '--note', 'fan on', '--shots', 'x'])).toMatchObject({ skipBuild: true, keep: true, note: 'fan on', shots: 'x' })
    expect(() => parseArgs(['--fast'])).toThrow('unknown option')
  })

  it('a quick run is shorter everywhere and its tray looks fit inside the tray time', () => {
    const [quick, full] = [plan(true), plan(false)]
    for (const k of ['settle', 'idle', 'play', 'tray'] as const) expect(quick[k]).toBeLessThan(full[k])
    expect(full.tray).toBe(600)
    for (const p of [quick, full]) {
      expect(p.idle).toBeLessThanOrEqual(p.tray)
      expect(Math.max(...p.trace)).toBeLessThan(p.tray - p.idle)
    }
    // Long enough to cross the 5 minutes after which the hidden page is suspended (background.rs).
    expect(full.trace.some((s) => s > 300)).toBe(true)
  })
})

describe('bench safety', () => {
  const roaming = String.raw`C:\Users\a\AppData\Roaming`
  const local = String.raw`C:\Users\a\AppData\Local`

  it('only ever names the two bench folders', () => {
    expect(benchFolders(BENCH_ID, roaming, local)).toEqual([String.raw`C:\Users\a\AppData\Roaming\app.legato.desktop.bench`, String.raw`C:\Users\a\AppData\Local\app.legato.desktop.bench`])
  })

  it('refuses every other identifier, the installed app and the dev build first', () => {
    for (const id of ['app.legato.desktop', 'app.legato.desktop.devbuild', 'dev.musicapp.desktop', 'app.legato.desktop.bench\\..', '']) {
      expect(() => benchFolders(id, roaming, local), id).toThrow()
    }
  })

  it('refuses when the user folders are unknown or relative', () => {
    expect(() => benchFolders(BENCH_ID, undefined, local)).toThrow('APPDATA')
    expect(() => benchFolders(BENCH_ID, roaming, 'Local')).toThrow('APPDATA')
  })

  it('uses the identifier of the bench config, which is not the installed app', () => {
    const conf = (f: string) => JSON.parse(readFileSync(new URL(`../src-tauri/${f}`, import.meta.url), 'utf8'))
    expect(conf('tauri.bench.conf.json').identifier).toBe(BENCH_ID)
    expect(conf('tauri.conf.json').identifier).not.toBe(BENCH_ID)
  })

  it('knows an exe built for another identifier', () => {
    expect(carriesId(Buffer.from('xx app.legato.desktop.bench yy'), BENCH_ID)).toBe(true)
    expect(carriesId(Buffer.from('xx app.legato.desktop yy'), BENCH_ID)).toBe(false)
  })

  it('hashes what builds the app, not what only describes it', () => {
    for (const f of ['src-tauri/src/lib.rs', 'src-tauri/tauri.bench.conf.json', 'crates/core/src/library.rs', 'ui/src/app/App.tsx', 'Cargo.lock', 'pnpm-lock.yaml']) expect(isBuildInput(f), f).toBe(true)
    for (const f of ['docs/performance.md', 'scripts/bench.mjs', 'crates/core/examples/bench_data.rs', 'ui/src/shared/format.test.ts', 'README.md', 'site/app/page.tsx', 'src-tauri/README.md']) expect(isBuildInput(f), f).toBe(false)
  })
})

describe('bench reading', () => {
  it('takes the WebView2 flags from the app, whole', () => {
    const args = browserArgs(readFileSync(new URL('../src-tauri/src/background.rs', import.meta.url), 'utf8'))
    expect(args).toContain('--disable-background-timer-throttling')
    expect(args).not.toContain('"')
    expect(() => browserArgs('const OTHER: &str = "x";')).toThrow('BROWSER_ARGS')
  })

  it('counts private working sets, WebView2 apart from the rest', () => {
    const m = memory(sample(0, [proc(1, 'legato-bench.exe', 0, 100 * MB), proc(2, 'msedgewebview2.exe', 0, 60 * MB), proc(3, 'MSEdgeWebView2.exe', 0, 40 * MB), proc(4, 'msedgewebview2.exe', 0, null)]))
    expect(m).toEqual({ app: 100, web: 100, total: 200, processes: 4 })
  })

  it('adds the CPU of processes that stay, are born or die inside the window', () => {
    const s = (cpu: number) => cpu * 1e7
    const samples = [
      sample(0, [proc(1, 'a', s(10), 0), proc(2, 'b', s(5), 0), proc(9, 'gone', s(1), 0)]),
      sample(5000, [proc(1, 'a', s(11), 0), proc(2, 'b', s(5), 0), proc(3, 'born', s(0.5), 0), proc(9, 'gone', s(2), 0)]),
      sample(10000, [proc(1, 'a', s(12), 0), proc(2, 'b', s(5), 0), proc(3, 'born', s(1), 0)]),
    ]
    // a: 2 s, b: 0, born: 1 s from zero, gone: 1 s until last seen.
    expect(cpuSeconds(samples)).toBeCloseTo(4)
  })

  it('does not count a reused pid that starts lower as negative CPU', () => {
    expect(cpuSeconds([sample(0, [proc(1, 'a', 5e7, 0)]), sample(5000, [proc(1, 'other', 1e7, 0)])])).toBe(0)
  })

  it('gives CPU as a share of one core and of the whole PC', () => {
    const { core, pc } = share(6, 60, 12)
    expect(core).toBeCloseTo(10)
    expect(pc).toBeCloseTo(10 / 12)
  })

  it('names the busiest processes, WebView2 ones by their kind', () => {
    const kind = (p: ReturnType<typeof proc>, k: string) => ({ ...p, kind: k })
    const samples = [
      sample(0, [proc(1, 'legato-bench.exe', 0, 0), kind(proc(2, 'msedgewebview2.exe', 0, 0), 'renderer'), kind(proc(3, 'msedgewebview2.exe', 0, 0), 'gpu-process'), kind(proc(4, 'msedgewebview2.exe', 0, 0), 'utility')]),
      sample(10000, [proc(1, 'legato-bench.exe', 1e7, 0), kind(proc(2, 'msedgewebview2.exe', 5e7, 0), 'renderer'), kind(proc(3, 'msedgewebview2.exe', 2e7, 0), 'gpu-process'), kind(proc(4, 'msedgewebview2.exe', 0, 0), 'utility')]),
    ]
    const w = summarize(samples, 12)
    expect(w.hot.map((h: { label: string }) => h.label)).toEqual(['renderer', 'gpu-process', 'legato-bench.exe'])
    expect(w.hot[0].core).toBeCloseTo(50)
  })

  it('sums a window up: seconds, share, RAM at the end, peak, PC load', () => {
    const samples = [
      sample(1000, [proc(1, 'legato-bench.exe', 0, 100 * MB), proc(2, 'msedgewebview2.exe', 0, 50 * MB)], 10),
      sample(31000, [proc(1, 'legato-bench.exe', 3e7, 120 * MB), proc(2, 'msedgewebview2.exe', 3e7, 90 * MB)], 20),
      sample(61000, [proc(1, 'legato-bench.exe', 6e7, 100 * MB), proc(2, 'msedgewebview2.exe', 6e7, 60 * MB)], 30),
    ]
    const w = summarize(samples, 12)
    expect(w.seconds).toBe(60)
    expect(w.cpu.core).toBeCloseTo(20)
    expect(w.ram.total).toBe(160)
    expect(w.peak).toBe(210)
    expect(w.pcLoad).toBe(20)
  })
})

describe('bench results file', () => {
  const doc = readFileSync(new URL('../docs/performance.md', import.meta.url), 'utf8')
  const window = (ram: number, cpu: number) => ({ seconds: 60, cpu: { core: cpu * 12, pc: cpu }, ram: { app: 1, web: ram - 1, total: ram, processes: 9 }, peak: ram, pcLoad: 5 })
  const result = { date: '2026-10-30', version: '1.0.0 (abc1234)', pc: 'Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300)', cold: { shown: 520, fcp: 930 }, restart: { shown: 310, fcp: 620 }, idle: window(245.4, 0.04), play: window(301.2, 1.96), tray: window(118.6, 0), note: 'other apps were running' }

  it('writes a row with as many cells as the results table has columns', () => {
    const header = doc.split('\n').find((l) => l.startsWith('| Date'))!
    const cells = (l: string) => l.split(' | ').length
    expect(cells(tableRow(result))).toBe(cells(header))
    expect(tableRow(result)).toBe('| 2026-10-30 | 1.0.0 (abc1234) | Ryzen 5 5500, 12 threads, 32 GB, Windows 11 (26300) | 0.52 / 0.31 s | 0.93 / 0.62 s | 245 / 301 / 119 | 0.0 / 2.0 / 0.0 | other apps were running |')
  })

  it('adds the row under the last one, and only to a doc that ends with the table', () => {
    const row = tableRow(result)
    expect(withRow('# T\n\n| a |\n|---|\n| 1 |\n', row)).toBe(`# T\n\n| a |\n|---|\n| 1 |\n${row}\n`)
    expect(() => withRow('# T\n\n| a |\n|---|\n\ntext after\n', row)).toThrow('results table')
    expect(doc.trimEnd().split('\n').pop()!.startsWith('|')).toBe(true)
  })
})
