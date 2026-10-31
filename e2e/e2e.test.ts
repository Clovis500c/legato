import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { carriesId } from '../scripts/guest.mjs'
import { answer, known, startMock } from './mock.mjs'
import { decodePng, strongShare } from './png.mjs'
import { DEFERRED_BY, E2E_ID, FEATURE_MARK, SHOTS, STEPS, appEnv, clearShots, deferredStarts, e2eFolders, flat, pace, parseArgs, shotFiles } from './smoke.mjs'
import { DEMO_SONGS, sineWav, writeDemo } from './wav.mjs'

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('smoke test options', () => {
  it('takes its few options, and nothing else', () => {
    expect(parseArgs([])).toMatchObject({ skipBuild: false, buildOnly: false, repeat: 1, keep: false })
    expect(parseArgs(['--skip-build', '--keep', '--repeat', '5', '--shots', 'x'])).toMatchObject({ skipBuild: true, keep: true, repeat: 5, shots: 'x' })
    expect(() => parseArgs(['--fast'])).toThrow('unknown option')
    for (const n of ['0', '51', 'many', '1.5']) expect(() => parseArgs(['--repeat', n]), n).toThrow('--repeat')
    expect(() => parseArgs(['--shots', ''])).toThrow('--shots')
  })
})

describe('smoke test safety', () => {
  const roaming = String.raw`C:\Users\a\AppData\Roaming`
  const local = String.raw`C:\Users\a\AppData\Local`

  it('only ever names its own two folders', () => {
    expect(e2eFolders(E2E_ID, roaming, local)).toEqual([String.raw`C:\Users\a\AppData\Roaming\app.legato.desktop.e2e`, String.raw`C:\Users\a\AppData\Local\app.legato.desktop.e2e`])
  })

  it('refuses every other identifier: the installed app, the dev build, the bench build', () => {
    for (const id of ['app.legato.desktop', 'app.legato.desktop.devbuild', 'app.legato.desktop.bench', 'dev.musicapp.desktop', 'app.legato.desktop.e2e\\..', '']) {
      expect(() => e2eFolders(id, roaming, local), id).toThrow()
    }
  })

  it('refuses when the user folders are unknown or relative', () => {
    expect(() => e2eFolders(E2E_ID, undefined, local)).toThrow('APPDATA')
    expect(() => e2eFolders(E2E_ID, roaming, 'Local')).toThrow('APPDATA')
  })

  it('names the pictures and steps of its walk, so it knows every file it leaves in the shots folder', () => {
    const walk = read('e2e/smoke.mjs')
    expect(SHOTS).toEqual([...walk.matchAll(/\bshot\('([^']+)'\)/g)].map((m) => m[1]))
    expect(STEPS).toEqual([...walk.matchAll(/\bstep\('([^']+)'/g)].map((m) => m[1]))
    expect(shotFiles()).toContain('FAIL-pause-play.png')
    // Plain file names: no wildcard, no folder, no way out of the shots folder.
    for (const f of shotFiles()) expect(f, f).toMatch(/^[\w-]+\.(png|txt|log)$/)
  })

  it('clears only the files an earlier walk wrote in --shots, whatever folder that is, and never the folder', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'legato-shots-'))
    try {
      mkdirSync(path.join(dir, 'sub'))
      const own = shotFiles()
      const others = ['holiday.png', 'notes.txt', 'package.json', 'sub/1-welcome.png']
      for (const f of [...own, ...others]) writeFileSync(path.join(dir, f), 'x')
      clearShots(dir)
      expect(readdirSync(dir).sort()).toEqual(['holiday.png', 'notes.txt', 'package.json', 'sub'])
      expect(existsSync(path.join(dir, 'sub', '1-welcome.png'))).toBe(true)
      // Nothing there yet, or nothing of its own: nothing to remove, and the folder is made.
      clearShots(dir)
      clearShots(path.join(dir, 'new', 'deeper'))
      expect(statSync(path.join(dir, 'new', 'deeper')).isDirectory()).toBe(true)
      expect(readdirSync(dir).sort()).toEqual(['holiday.png', 'new', 'notes.txt', 'package.json', 'sub'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the identifier of its config, which is not the installed app', () => {
    const id = (f: string) => JSON.parse(read(`src-tauri/${f}`)).identifier
    expect(id('tauri.e2e.conf.json')).toBe(E2E_ID)
    expect(id('tauri.conf.json')).not.toBe(E2E_ID)
    expect(carriesId(Buffer.from(`x ${E2E_ID} y`), E2E_ID)).toBe(true)
    // The bench build's name starts the same way: not the same build.
    expect(carriesId(Buffer.from('x app.legato.desktop.bench y'), E2E_ID)).toBe(false)
  })

  it('looks for the variable the app reads, and the app reads it only in the e2e feature', () => {
    const hosts = read('src-tauri/src/hosts.rs')
    expect(hosts).toContain(`"${FEATURE_MARK}"`)
    // The one use: inside the function the feature compiles.
    const use = hosts.indexOf(`"${FEATURE_MARK}"`)
    expect(hosts.lastIndexOf('#[cfg(feature = "e2e")]', use)).toBeGreaterThan(hosts.lastIndexOf('#[cfg(not(feature = "e2e"))]', use))
    expect(hosts.split(`"${FEATURE_MARK}"`)).toHaveLength(2)
    // Nowhere else in the app's own code.
    for (const f of ['src-tauri/src/lib.rs', 'crates/connectors/src/lib.rs', 'crates/player/src/lib.rs']) expect(read(f), f).not.toContain(FEATURE_MARK)
  })

  it('puts every other host behind a dead proxy and keeps loopback direct', () => {
    const env = appEnv({ Path: 'C:\\x', http_proxy: 'http://proxy.corp:8080', No_Proxy: 'corp', LEGATO_E2E_MOCK: 'http://evil', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--old' }, { flags: '--remote-debugging-port=1', mock: 'http://127.0.0.1:2' })
    expect(env).toMatchObject({ Path: 'C:\\x', LEGATO_E2E_BROWSER_ARGS: '--remote-debugging-port=1', LEGATO_E2E_MOCK: 'http://127.0.0.1:2', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' })
    expect(env).not.toHaveProperty('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
    // None of the shell's own spellings is left to win.
    expect(Object.keys(env).filter((k) => /proxy/i.test(k)).sort()).toEqual(['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'])
  })
})

describe('smoke test checks', () => {
  it('counts what started the deferred work from the log, and says the words the app logs', () => {
    const log = `2026-10-31T10:00:00.000Z INFO app started 0.2.0
2026-10-31T10:00:01.000Z INFO startup ${DEFERRED_BY.ready}
2026-10-31T10:00:09.000Z INFO startup ${DEFERRED_BY.timer}
`
    expect(deferredStarts(log)).toEqual({ ready: 1, timer: 1 })
    expect(deferredStarts('')).toEqual({ ready: 0, timer: 0 })
    const rust = read('src-tauri/src/deferred.rs')
    for (const words of Object.values(DEFERRED_BY)) expect(rust, words).toContain(`"${words}"`)
  })

  it('tells a song that keeps time from one that does not', () => {
    expect(pace(3000, 3000)).toBe('')
    expect(pace(2000, 3000)).toBe('')
    expect(pace(3900, 3000)).toBe('')
    expect(pace(0, 3000)).toContain('does not play')
    expect(pace(1000, 3000)).toContain('does not play')
    expect(pace(9000, 3000)).toContain('ahead of the clock')
  })

  it('reads tab labels without their line breaks', () => {
    expect(flat('YouTube Music\n\n2 ')).toBe('YouTube Music 2')
  })
})

describe('demo songs', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('writes a WAV the player reads: PCM, mono, 44.1 kHz, the length asked, a quiet tone', () => {
    const wav = sineWav(2, 440)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
    expect([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)]).toEqual([1, 1, 44100, 16])
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(2 * 44100 * 2)
    const peak = Math.max(...Array.from({ length: 44100 }, (_, i) => Math.abs(wav.readInt16LE(44 + i * 2)))) / 32767
    expect(peak).toBeGreaterThan(0.29)
    expect(peak).toBeLessThanOrEqual(0.3)
  })

  it('names its songs "Artist - Title.wav" so the scan finds both without tags, and they are long enough to play 3 s', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'legato-demo-'))
    dirs.push(dir)
    writeDemo(dir)
    expect(readdirSync(dir).sort()).toEqual(DEMO_SONGS.map((s) => s.file).sort())
    for (const s of DEMO_SONGS) {
      expect(s.file).toBe(`${s.artist} - ${s.title}.wav`)
      expect(s.seconds).toBeGreaterThan(10)
      expect(statSync(path.join(dir, s.file)).size).toBe(44 + s.seconds * 44100 * 2)
    }
  })
})

describe('mock network', () => {
  it('answers each service the e2e build is pointed at', () => {
    const body = (method: string, pathname: string, query = '') => JSON.parse(answer(method, pathname, new URLSearchParams(query)).body)
    expect(JSON.stringify(body('POST', '/youtube/search'))).toContain('videoRenderer')
    expect(JSON.stringify(body('POST', '/ytmusic/search'))).toContain('musicResponsiveListItemRenderer')
    expect(body('GET', '/itunes/search').results).toHaveLength(2)
    expect(body('GET', '/itunes/lookup').results).toEqual([])
    expect(body('GET', '/itunes/lookup', 'id=1440857781').results).toHaveLength(3)
    expect(body('GET', '/deezer/playlist/2477790684').nb_tracks).toBe(153)
    expect(body('GET', '/deezer/playlist/2477790684/tracks', 'index=0&limit=100').data).toHaveLength(2)
    expect(body('GET', '/deezer/playlist/2477790684/tracks', 'index=2&limit=100').data).toEqual([])
    expect(body('GET', '/suggest', 'q=paper')[1]).toContain('paper glass harbour')
  })

  it('finds one song of each pasted list on YouTube, a second late, and none for the other', () => {
    const search = (service: string, query: string) => answer('POST', `/${service}/search`, new URLSearchParams(), { query })
    const found = search('youtube', "Macklemore Can't Hold Us (feat. Ray Dalton)")
    expect(found.body).toContain('Macklemore - Can')
    expect(found.delay).toBeGreaterThan(500)
    expect(search('youtube', 'Jack Johnson Better Together').body).toContain('Jack Johnson - Better Together')
    expect(JSON.stringify(JSON.parse(search('youtube', 'Lykke Li I Follow Rivers').body))).not.toContain('videoRenderer')
    expect(search('ytmusic', 'Lykke Li I Follow Rivers').body).toBe('{}')
    // The walk's own search keeps the default results, at once.
    expect(search('youtube', 'paper lanterns')).toMatchObject({ delay: 0 })
    expect(search('youtube', 'paper lanterns').body).toContain('Paper Lanterns')
    expect(search('ytmusic', 'paper lanterns').body).toContain('musicResponsiveListItemRenderer')
  })

  it('says "not found" the way LRCLIB does, and to anything it does not know', () => {
    expect(answer('GET', '/lrclib/get', new URLSearchParams()).status).toBe(404)
    expect(known('GET', '/lrclib/get')).toBe(true)
    expect(answer('GET', '/spotify/me', new URLSearchParams()).status).toBe(404)
    expect(known('GET', '/spotify/me')).toBe(false)
    expect(known('GET', '/youtube/search')).toBe(false)
  })

  it('serves on loopback, records what it is asked and lists the calls it has no route for', async () => {
    const mock = await startMock()
    try {
      expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      const res = await fetch(`${mock.url}/youtube/search?prettyPrint=false`, { method: 'POST', body: JSON.stringify({ query: 'paper lanterns' }) })
      expect(res.status).toBe(200)
      expect(JSON.stringify(await res.json())).toContain('Paper Lanterns')
      await fetch(`${mock.url}/lrclib/get?track_name=x`)
      await fetch(`${mock.url}/itunes/lookup?id=1`)
      await fetch(`${mock.url}/nowhere`)
      expect(mock.to('POST', '/youtube/search')[0].body).toEqual({ query: 'paper lanterns' })
      expect(mock.to('GET', '/lrclib/get')[0].query).toEqual({ track_name: 'x' })
      expect(mock.unexpected().map((r) => r.path)).toEqual(['/nowhere'])
    } finally {
      await mock.close()
    }
  })
})

describe('picture check', () => {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
    return Buffer.concat([head, body, tail])
  }
  /** A PNG of `rows` (arrays of [r, g, b]), each row written with the given filter (0 none, 1 sub, 2 up). */
  const png = (rows: number[][][], filters: number[]) => {
    const w = rows[0].length
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(rows.length, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    const raw: number[] = []
    rows.forEach((row, y) => {
      const flat = row.flat()
      raw.push(filters[y])
      flat.forEach((v, x) => raw.push((v - (filters[y] === 1 ? (flat[x - 3] ?? 0) : filters[y] === 2 ? (rows[y - 1]?.flat()[x] ?? 0) : 0) + 256) & 255))
    })
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))])
  }

  it('reads pixels through the filters', () => {
    const rows = [
      [[10, 20, 30], [40, 50, 60]],
      [[70, 80, 90], [100, 110, 120]],
      [[1, 2, 3], [4, 5, 6]],
    ]
    const got = decodePng(png(rows, [0, 1, 2]))
    expect([got.width, got.height, got.channels]).toEqual([2, 3, 3])
    expect([...got.data]).toEqual(rows.flat(2))
  })

  it('tells a blank or faintly patterned picture from one with lit bars', () => {
    const flat = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => [20, 20, 20]))
    expect(strongShare(decodePng(png(flat, Array(10).fill(0))))).toBe(0)
    const faint = flat.map((row, y) => row.map((p) => (y % 2 ? [40, 40, 40] : p)))
    expect(strongShare(decodePng(png(faint, Array(10).fill(0))))).toBe(0)
    const lit = flat.map((row, y) => row.map((p, x) => (x === 3 && y > 4 ? [230, 230, 230] : p)))
    expect(strongShare(decodePng(png(lit, Array(10).fill(0))))).toBeCloseTo(0.05, 5)
  })
})
