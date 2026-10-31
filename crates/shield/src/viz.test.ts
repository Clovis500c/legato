import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The visualizer maths of live.js (the block between viz:begin and viz:end), run here against a model of Chromium's
// AnalyserNode (Blackman window, FFT scaled by 1/N, 20 log10 of the magnitude). Its Rust twin: crates/dsp/src/viz.rs;
// `crates/dsp/fixtures/viz.json` holds the signals and what the Rust side reads from them.
const src = readFileSync(new URL('./live.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// viz:begin'), src.indexOf('// viz:end'))
const viz = new Function(`${block}; return { vizMap, vizNorm, vizBands, vizLevels, vizPack, vizCentre, VIZ_N, VIZ_BANDS }`)() as {
  vizMap: (rate: number) => [number, number[]][]
  vizNorm: () => number
  vizBands: (map: [number, number[]][], norm: number, bins: Float32Array) => number[]
  vizLevels: (x: Float32Array, hop: number) => { rms: number; peak: number; any: boolean }
  vizPack: (rms: number[], peak: number[], left: number[], right: number[]) => Uint8Array
  vizCentre: (i: number) => number
  VIZ_N: number
  VIZ_BANDS: number
}
const N = viz.VIZ_N
const BANDS = viz.VIZ_BANDS

interface Fixture {
  rate: number
  signals: { name: string; components: { hz: number; amp: number; phase: number; left: boolean; right: boolean }[]; left: number[]; right: number[] }[]
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

/** What AnalyserNode.getFloatFrequencyData gives for the last N samples (smoothing 0): dB per bin. */
function analyser(x: ArrayLike<number>): Float32Array {
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / N) + 0.08 * Math.cos((4 * Math.PI * n) / N)
    re[n] = Math.fround(x[n]) * w
  }
  fft(re, im)
  const out = new Float32Array(N / 2)
  for (let k = 0; k < N / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N)
  return out
}

const sine = (hz: number, amp: number, rate: number) => Float64Array.from({ length: N }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))
const read = (x: ArrayLike<number>, rate: number) => viz.vizBands(viz.vizMap(rate), viz.vizNorm(), analyser(x))

describe('bands', () => {
  it('are 1/6 octave, 20 Hz to 20 kHz, 61 of them', () => {
    expect(BANDS).toBe(61)
    expect(viz.vizCentre(0)).toBeCloseTo(19.95, 2)
    expect(viz.vizCentre(34)).toBeCloseTo(1000, 9)
    expect(viz.vizCentre(60)).toBeCloseTo(19952.6, 0)
  })

  it('a sine at a band center lights that band within 0.5 dB, neighbours 15 dB under where bands are wide', () => {
    for (const rate of [44100, 48000]) {
      const map = viz.vizMap(rate)
      expect(map).toHaveLength(BANDS)
      const df = rate / N
      for (let i = 0; i < BANDS; i++) {
        const b = read(sine(viz.vizCentre(i), 1, rate), rate)
        expect(Math.abs(b[i]), `${rate} Hz band ${i}: ${b[i]}`).toBeLessThan(0.5)
        // Blackman's lobe is 6 bins wide: 15 dB needs 4.5 bins between centers (Hann's 3.3), 460 Hz and up at 48 kHz.
        const wide = (viz.vizCentre(i) * 0.122) / df >= 4.5
        for (const j of [i - 1, i + 1].filter((j) => j >= 0 && j < BANDS)) {
          if (wide) expect(b[j], `${rate} Hz band ${i} lights ${j}`).toBeLessThan(-15)
          else expect(b[j], `${rate} Hz band ${i} vs ${j}`).toBeLessThanOrEqual(b[i] + 1)
        }
      }
    }
  })

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
  })
})

describe('the twins', () => {
  // Hann (Rust) and Blackman (here) resolve differently: a Blackman lobe is wider (6 bins against 4), so a sine leaks
  // more into its neighbour bands (4 dB at 15 to 25 dB under it), and the lowest bands, narrower than either window
  // can see, spread differently. The contract: the bands that carry sound (within 10 dB of the loudest, in either twin)
  // agree within 2 dB from 320 Hz up (band 27; a dense signal, sines closer than a lobe, is what costs the last dB), within 4 dB below; the rest are dark in both.
  const tolerance = (i: number) => (i >= 27 ? 2 : 4)

  for (const s of fixture.signals) {
    it(`read ${s.name} alike`, () => {
      const render = (side: 'left' | 'right') => {
        const x = new Float64Array(N)
        for (const c of s.components) if (c[side]) for (let i = 0; i < N; i++) x[i] += c.amp * Math.sin((2 * Math.PI * c.hz * i) / fixture.rate + c.phase)
        return x
      }
      for (const [side, want] of [['left', s.left], ['right', s.right]] as const) {
        const got = read(render(side), fixture.rate)
        const loud = Math.max(...want, ...got)
        for (let i = 0; i < BANDS; i++) {
          if (Math.max(want[i], got[i]) <= loud - 10) continue
          expect(Math.abs(got[i] - want[i]), `${s.name}, ${side}, band ${i} (${viz.vizCentre(i).toFixed(0)} Hz): ${got[i]} vs ${want[i]}`).toBeLessThan(tolerance(i))
        }
      }
    })
  }

  it('the silent side of a signal is silent in both', () => {
    const s = fixture.signals[0]
    expect(s.right.every((v) => v === -120)).toBe(true)
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

  it('levels: rms over the window, peak over the last hop, silence is zero', () => {
    const x = new Float32Array(N).fill(0.1)
    x[10] = 0.9
    const l = viz.vizLevels(x, 800)
    expect(l.peak).toBeCloseTo(20 * Math.log10(0.1), 3)
    expect(l.any).toBe(true)
    expect(viz.vizLevels(new Float32Array(N), 800)).toEqual({ rms: -120, peak: -120, any: false })
  })
})
