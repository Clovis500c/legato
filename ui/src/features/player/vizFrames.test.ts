import { describe, expect, it } from 'vitest'
import { createViz, type VizSource } from './vizFrames'
import { bandHz, fromBase64, isSilent, silentViz, toBytes, unpackViz, VIZ_BANDS } from './vizUnpack'

/** A packed frame the way crates/dsp `Frame::pack` writes it: rms L R, peak L R in bytes, then the bands. */
function pack(rms: [number, number], peak: [number, number], left: number[], right: number[] = left): Uint8Array {
  const b = new Uint8Array(8 + 2 * VIZ_BANDS)
  b.set([1, VIZ_BANDS, 0, 0, ...rms, ...peak])
  b.set(left, 8)
  b.set(right, 8 + VIZ_BANDS)
  return b
}
const bands = (at: Record<number, number>) => Array.from({ length: VIZ_BANDS }, (_, i) => at[i] ?? 0)

describe('visualizer frame bytes', () => {
  it('unpacks half decibels from -120, as the Rust and JS packers write them', () => {
    // The frame crates/dsp viz.rs tests: rms -3 / floor, peak 0 / +7.5, band 60 on the right at -0.5.
    const b = pack([234, 0], [240, 255], bands({}), bands({ 60: 239 }))
    const f = unpackViz(b)!
    expect([...f.rms, ...f.peak]).toEqual([-3, -120, 0, 7.5])
    expect(f.left[10]).toBe(-120)
    expect(f.right[60]).toBe(-0.5)
    expect(f.left).toHaveLength(VIZ_BANDS)
  })

  it('refuses what is not a frame', () => {
    const ok = pack([0, 0], [0, 0], bands({}))
    expect(unpackViz(ok.slice(1))).toBeNull()
    expect(unpackViz(Uint8Array.from(ok, (v, i) => (i === 0 ? 2 : v)))).toBeNull()
    expect(unpackViz(Uint8Array.from(ok, (v, i) => (i === 1 ? 31 : v)))).toBeNull()
    expect(unpackViz(new Uint8Array(0))).toBeNull()
  })

  it('takes bytes from a channel, a typed view or text', () => {
    const b = pack([0, 0], [0, 0], bands({}))
    expect(toBytes(b.buffer)).toEqual(b)
    expect(toBytes(new DataView(b.buffer))).toEqual(b)
    expect(toBytes([1, 2, 3])).toEqual(Uint8Array.of(1, 2, 3))
    expect(toBytes([1, 300])).toBeNull()
    expect(toBytes('x')).toBeNull()
    expect(fromBase64(btoa(String.fromCharCode(...b)))).toEqual(b)
    expect(fromBase64('***')).toBeNull()
  })

  it('knows the band centers and silence', () => {
    expect(bandHz(34)).toBe(1000)
    expect(bandHz(0)).toBeCloseTo(19.95, 2)
    expect(bandHz(60)).toBeCloseTo(19952.6, 0)
    expect(isSilent(silentViz())).toBe(true)
    expect(isSilent({ ...silentViz(), rms: [-3, -120] })).toBe(false)
  })
})

describe('visualizer frame source', () => {
  const loud = pack([200, 200], [220, 220], bands({ 34: 230 }))
  const quiet = pack([0, 0], [0, 0], new Array(VIZ_BANDS).fill(0))
  const wait = () => new Promise((r) => setTimeout(r, 0))

  function setup(source: VizSource) {
    const calls: string[] = []
    let push: (b: unknown) => void = () => {}
    let now = source
    const counts: number[] = []
    const v = createViz(
      {
        start: async (onBytes) => {
          calls.push('start')
          push = onBytes
          return () => void calls.push('release')
        },
        stop: async () => void calls.push('stop'),
        source: () => now,
      },
      (n) => counts.push(n),
    )
    return { v, calls, counts, native: (b: unknown) => push(b), play: (s: VizSource) => void (now = s) }
  }

  it('starts the engine for the first listener and stops it after the last, in order', async () => {
    const { v, calls, counts } = setup('native')
    const a = v.subscribe(() => {})
    const b = v.subscribe(() => {})
    await wait()
    expect(calls).toEqual(['start'])
    a()
    a()
    expect(v.count()).toBe(1)
    b()
    await wait()
    expect(calls).toEqual(['start', 'release', 'stop'])
    expect(counts).toEqual([1, 2, 1, 0])
    // Again at once: start waits for the stop before it, whatever order the engine would run them in.
    v.subscribe(() => {})()
    v.subscribe(() => {})
    await wait()
    expect(calls.slice(3)).toEqual(['start', 'release', 'stop', 'start'])
  })

  it('gives frames of the twin that plays, as they came, and the newest one on request', async () => {
    const { v, native, play } = setup('native')
    const got: number[] = []
    v.subscribe((f) => got.push(f.left[34]))
    await wait()
    expect(v.latest()).toBeNull()
    native(loud.buffer)
    expect(got).toEqual([-5])
    expect(v.latest()?.left[34]).toBe(-5)
    // YouTube's frame while the engine plays: not ours.
    v.fromYoutube(btoa(String.fromCharCode(...quiet)))
    expect(got).toEqual([-5])
    play('youtube')
    native(quiet.buffer)
    expect(got).toEqual([-5])
    v.fromYoutube(btoa(String.fromCharCode(...loud)))
    expect(got).toEqual([-5, -5])
  })

  it('lets only the silence of a stop through when nothing plays', async () => {
    const { v, native, play } = setup(null)
    v.subscribe(() => {})
    await wait()
    native(loud.buffer)
    expect(v.latest()).toBeNull()
    native(pack([0, 0], [0, 0], new Array(VIZ_BANDS).fill(0)).buffer)
    expect(v.latest() && isSilent(v.latest()!)).toBe(true)
    play('native')
    native(new Uint8Array(5).buffer)
    expect(isSilent(v.latest()!)).toBe(true)
  })

  it('survives an engine that cannot start', async () => {
    const v = createViz({ start: () => Promise.reject(new Error('no')), stop: async () => {}, source: () => 'native' })
    v.subscribe(() => {})
    await wait()
    expect(v.count()).toBe(1)
  })
})
