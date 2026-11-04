import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The visualizer maths of live.js (the block between viz:begin and viz:end), run here against a model of Chromium's
// AnalyserNode (Blackman window, FFT scaled by 1/N, 20 log10 of the magnitude). Its Rust twin: crates/dsp/src/viz.rs;
// `crates/dsp/fixtures/viz.json` holds the signals and what the Rust side reads from them, in sixths and twelfths.
const src = readFileSync(new URL('./live.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// viz:begin'), src.indexOf('// viz:end'))
const viz = new Function(`${block}; return { vizMap, vizNorm, vizBands, vizLevels, vizPack, vizCentre, VIZ_N, VIZ_N_FINE, VIZ_BANDS, VIZ_FINE }`)() as {
  vizMap: (rate: number, count?: number, n?: number) => [number, number[]][]
  vizNorm: (size?: number) => number
  vizBands: (map: [number, number[]][], norm: number, bins: Float32Array) => number[]
  vizLevels: (x: Float32Array, hop: number, last?: number) => { rms: number; peak: number; any: boolean }
  vizPack: (rms: number[], peak: number[], left: number[], right: number[]) => Uint8Array
  vizCentre: (i: number, count?: number) => number
  VIZ_N: number
  VIZ_N_FINE: number
  VIZ_BANDS: number
  VIZ_FINE: number
}
const N = viz.VIZ_N
const BANDS = viz.VIZ_BANDS
const FINE = viz.VIZ_FINE

/** Sixths (61 bands over 4096 points) and twelfths (121 over 8192). */
const kinds = [
  { name: 'sixths', count: BANDS, n: N },
  { name: 'twelfths', count: FINE, n: viz.VIZ_N_FINE },
]
type Kind = (typeof kinds)[number]

interface Fixture {
  rate: number
  signals: {
    name: string
    components: { hz: number; amp: number; phase: number; left: boolean; right: boolean }[]
    left: number[]
    right: number[]
    fineLeft: number[]
    fineRight: number[]
  }[]
}
const fixture = JSON.parse(readFileSync(new URL('../../dsp/fixtures/viz.json', import.meta.url), 'utf8')) as Fixture

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** What AnalyserNode.getFloatFrequencyData gives for the last n samples (fftSize n, smoothing 0): dB per bin. */
function analyser(x: ArrayLike<number>, n: number): Float32Array {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n)
    re[i] = Math.fround(x[i]) * w
  }
  fft(re, im)
  const out = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n)
  return out
}

const sine = (hz: number, amp: number, rate: number, n = N) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

const maps = new Map<string, { map: [number, number[]][]; norm: number }>()
const read = (x: ArrayLike<number>, rate: number, k: Kind = kinds[0]) => {
  const key = `${rate} ${k.count}`
  let m = maps.get(key)
  if (!m) {
    m = { map: viz.vizMap(rate, k.count, k.n), norm: viz.vizNorm(k.n) }
    maps.set(key, m)
  }
  return viz.vizBands(m.map, m.norm, analyser(x, k.n))
}

describe('bands', () => {
  it('are 1/6 octave, 20 Hz to 20 kHz, 61 of them', () => {
    expect(BANDS).toBe(61)
    expect(viz.vizCentre(0)).toBeCloseTo(19.95, 2)
    expect(viz.vizCentre(34)).toBeCloseTo(1000, 9)
    expect(viz.vizCentre(60)).toBeCloseTo(19952.6, 0)
  })

  it('in twelfths are 121, two to a sixth, on the same scale', () => {
    expect(FINE).toBe(121)
    expect(viz.vizCentre(0, FINE)).toBeCloseTo(19.95, 2)
    expect(viz.vizCentre(68, FINE)).toBeCloseTo(1000, 9)
    expect(viz.vizCentre(120, FINE)).toBeCloseTo(19952.6, 0)
    for (let i = 0; i < BANDS; i++) expect(viz.vizCentre(2 * i, FINE)).toBeCloseTo(viz.vizCentre(i), 6)
  })

  for (const k of kinds) {
    it(`a sine at a band center lights that band within 0.5 dB, neighbours 15 dB under where bands are wide (${k.name})`, () => {
      // From one centre to the next: 12 % (sixths), 6 % (twelfths).
      const step = 10 ** (3 / (k.count - 1)) - 1
      for (const rate of [44100, 48000]) {
        const map = viz.vizMap(rate, k.count, k.n)
        expect(map).toHaveLength(k.count)
        const df = rate / k.n
        for (let i = 0; i < k.count; i++) {
          const b = read(sine(viz.vizCentre(i, k.count), 1, rate, k.n), rate, k)
          expect(Math.abs(b[i]), `${rate} Hz band ${i}: ${b[i]}`).toBeLessThan(0.5)
          // Blackman's lobe is 6 bins wide: 15 dB needs 4.5 bins between centers (Hann's 3.3), 460 Hz and up at 48 kHz.
          const wide = (viz.vizCentre(i, k.count) * step) / df >= 4.5
          for (const j of [i - 1, i + 1].filter((j) => j >= 0 && j < k.count)) {
            if (wide) expect(b[j], `${rate} Hz band ${i} lights ${j}`).toBeLessThan(-15)
            else expect(b[j], `${rate} Hz band ${i} vs ${j}`).toBeLessThanOrEqual(b[i] + 1)
          }
        }
      }
    })
  }

  it('a left-only sine shows only on the left', () => {
    const left = read(sine(1000, 0.5, 48000), 48000)
    const right = read(new Float64Array(N), 48000)
    expect(left[34]).toBeCloseTo(-6.02, 0)
    expect(right.every((v) => v === -120)).toBe(true)
  })

  it('bands above Nyquist read nothing', () => {
    const map = viz.vizMap(22050)
    expect(map[BANDS - 1][1]).toHaveLength(0)
    expect(map[50][1].length).toBeGreaterThan(0)
    const fine = viz.vizMap(22050, FINE, viz.VIZ_N_FINE)
    expect(fine[FINE - 1][1]).toHaveLength(0)
    expect(fine[100][1].length).toBeGreaterThan(0)
  })
})

describe('the twins', () => {
  // Hann (Rust) and Blackman (here) resolve differently: a Blackman lobe is wider (6 bins against 4), so a sine leaks
  // more into its neighbour bands (4 dB at 15 to 25 dB under it), and the lowest bands, narrower than either window
  // can see, spread differently. The contract: the bands that carry sound (within 10 dB of the loudest, in either twin)
  // agree within 2 dB from 450 Hz up (sixth 27, twelfth 54; a dense signal, sines closer than a lobe, is what costs the last dB), within 4 dB below; the rest are dark in both.
  const tolerance = (i: number, k: Kind) => (i >= (k.count === FINE ? 54 : 27) ? 2 : 4)

  for (const k of kinds) {
    for (const s of fixture.signals) {
      it(`read ${s.name} alike (${k.name})`, () => {
        const render = (side: 'left' | 'right') => {
          const x = new Float64Array(k.n)
          for (const c of s.components) if (c[side]) for (let i = 0; i < k.n; i++) x[i] += c.amp * Math.sin((2 * Math.PI * c.hz * i) / fixture.rate + c.phase)
          return x
        }
        const fine = k.count === FINE
        const sides = [
          ['left', fine ? s.fineLeft : s.left],
          ['right', fine ? s.fineRight : s.right],
        ] as const
        for (const [side, want] of sides) {
          expect(want).toHaveLength(k.count)
          const got = read(render(side), fixture.rate, k)
          const loud = Math.max(...want, ...got)
          for (let i = 0; i < k.count; i++) {
            if (Math.max(want[i], got[i]) <= loud - 10) continue
            expect(Math.abs(got[i] - want[i]), `${s.name}, ${side}, band ${i} (${viz.vizCentre(i, k.count).toFixed(0)} Hz): ${got[i]} vs ${want[i]}`).toBeLessThan(tolerance(i, k))
          }
        }
      })
    }
  }

  it('the silent side of a signal is silent in both', () => {
    const s = fixture.signals[0]
    expect(s.right.every((v) => v === -120)).toBe(true)
    expect(s.fineRight.every((v) => v === -120)).toBe(true)
    expect(read(new Float64Array(N), fixture.rate).every((v) => v === -120)).toBe(true)
  })
})

describe('frames', () => {
  it('pack to 130 bytes of half decibels, as the Rust side does', () => {
    const silent = new Array(BANDS).fill(-120)
    const bands = silent.map((_, i) => (i === 60 ? -0.26 : -120))
    const b = viz.vizPack([-3, -120], [0, 20], silent, bands)
    expect(b).toHaveLength(8 + 2 * BANDS)
    expect([b[0], b[1], b[4], b[5], b[6], b[7]]).toEqual([1, 61, 234, 0, 240, 255])
    expect(b[8 + BANDS + 60]).toBe(239)
    expect(Math.max(...b.slice(8, 8 + BANDS))).toBe(0)
  })

  it('pack twelfths to 250 bytes, the count in the header', () => {
    const silent = new Array(FINE).fill(-120)
    const b = viz.vizPack([-120, -120], [-120, -120], silent, silent.map((_, i) => (i === FINE - 1 ? 0 : -120)))
    expect(b).toHaveLength(8 + 2 * FINE)
    expect([b[0], b[1]]).toEqual([1, 121])
    expect(b[8 + 2 * FINE - 1]).toBe(240)
  })

  it('levels: rms over the window, peak over the last hop, silence is zero', () => {
    const x = new Float32Array(N).fill(0.1)
    x[10] = 0.9
    const l = viz.vizLevels(x, 800)
    expect(l.peak).toBeCloseTo(20 * Math.log10(0.1), 3)
    expect(l.any).toBe(true)
    expect(viz.vizLevels(new Float32Array(N), 800)).toEqual({ rms: -120, peak: -120, any: false })
  })

  it('levels in twelfths: rms over the last 4096 samples, as in sixths', () => {
    const x = new Float32Array(viz.VIZ_N_FINE)
    x.fill(0.5, 0, N)
    x.fill(0.1, N)
    expect(viz.vizLevels(x, 800, N).rms).toBeCloseTo(20 * Math.log10(0.1), 3)
    const early = new Float32Array(viz.VIZ_N_FINE)
    early[0] = 0.5
    expect(viz.vizLevels(early, 800, N)).toEqual({ rms: -120, peak: -120, any: true })
  })
})
