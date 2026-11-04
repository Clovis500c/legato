import { describe, expect, it } from 'vitest'
import { createViz, type VizSource } from './vizFrames'
import { bandHz, fromBase64, isSilent, silentViz, toBytes, unpackViz, VIZ_BANDS, VIZ_FINE, VIZ_WAVE } from './vizUnpack'

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

  it('unpacks twelfths: 121 bands, two to a sixth', () => {
    const b = new Uint8Array(8 + 2 * VIZ_FINE)
    b.set([1, VIZ_FINE, 0, 0, 234, 0, 240, 255])
    b[8 + VIZ_FINE + 120] = 239
    const f = unpackViz(b)!
    expect(f.left).toHaveLength(VIZ_FINE)
    expect(f.right[120]).toBe(-0.5)
    // The count must match the size.
    expect(unpackViz(Uint8Array.from(b, (v, i) => (i === 1 ? VIZ_BANDS : v)))).toBeNull()
    expect(bandHz(68, VIZ_FINE)).toBe(1000)
    for (let i = 0; i < VIZ_BANDS; i++) expect(bandHz(2 * i, VIZ_FINE)).toBeCloseTo(bandHz(i), 6)
    expect(silentViz(VIZ_FINE).left).toHaveLength(VIZ_FINE)
  })

  it('unpacks the wave blocks after the bands when flag 1 says so, i16 little-endian', () => {
    const b = new Uint8Array(8 + 2 * VIZ_BANDS + 4 * VIZ_WAVE)
    b.set([1, VIZ_BANDS, 1, 0])
    const wave = new DataView(b.buffer, 8 + 2 * VIZ_BANDS)
    wave.setInt16(0, 32767, true)
    wave.setInt16(2 * (VIZ_WAVE - 1), -32767, true)
    wave.setInt16(2 * (VIZ_WAVE + 3), 16384, true)
    const f = unpackViz(b)!
    expect(f.left).toHaveLength(VIZ_BANDS)
    expect(f.wave![0][0]).toBe(1)
    expect(f.wave![0][VIZ_WAVE - 1]).toBe(-1)
    expect(f.wave![1][3]).toBeCloseTo(0.5, 4)
    expect(f.wave![1]).toHaveLength(VIZ_WAVE)
    // The flag and the size go together; a frame without it has none.
    expect(unpackViz(b.slice(0, 8 + 2 * VIZ_BANDS))).toBeNull()
    expect(unpackViz(Uint8Array.from(b, (v, i) => (i === 2 ? 0 : v)))).toBeNull()
    expect(unpackViz(pack([0, 0], [0, 0], bands({})))!.wave).toBeUndefined()
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
        start: async (onBytes, ask) => {
          calls.push(['start', ask.fine && 'fine', ask.wave && 'wave'].filter(Boolean).join(' '))
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

  it('starts the stream again in twelfths or with waves while it runs, else waits for the next listener', async () => {
    const { v, calls } = setup('native')
    v.setAsk({ fine: true, wave: false })
    v.setAsk({ fine: true, wave: false })
    await wait()
    expect(calls).toEqual([])
    const off = v.subscribe(() => {})
    await wait()
    expect(calls).toEqual(['start fine'])
    v.setAsk({ fine: false, wave: true })
    v.setAsk({ fine: false, wave: true })
    await wait()
    expect(calls).toEqual(['start fine', 'release', 'start wave'])
    off()
    await wait()
    expect(calls.slice(3)).toEqual(['release', 'stop'])
  })

  it('passes frames in twelfths on as they come', async () => {
    const { v, native } = setup('native')
    const got: number[] = []
    v.subscribe((f) => got.push(f.left.length))
    await wait()
    const fine = new Uint8Array(8 + 2 * VIZ_FINE)
    fine.set([1, VIZ_FINE, 0, 0, 200, 200, 220, 220])
    native(fine.buffer)
    expect(got).toEqual([VIZ_FINE])
  })

  it('survives an engine that cannot start', async () => {
    const v = createViz({ start: () => Promise.reject(new Error('no')), stop: async () => {}, source: () => 'native' })
    v.subscribe(() => {})
    await wait()
    expect(v.count()).toBe(1)
  })
})
