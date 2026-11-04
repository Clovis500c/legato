import { describe, expect, it } from 'vitest'
import { bandAt, createBeat } from './vizBeat'

/** A seeded generator, 0 to 1. */
function random(seed = 7) {
  return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
}

/**
 * Frames of a click track as the visualizer gets them: every band near -60 dB with a little hiss, and at each click the
 * lows jump to -20 dB and the mids by 10 dB, falling back over about 100 ms.
 */
function clickTrack(bpm: number, seconds: number, n = 61, jitter = 0) {
  const r = random()
  const period = 60 / bpm
  const frames: { t: number; bands: Float32Array }[] = []
  for (let k = 0, t = 0; t < seconds; k++) {
    const since = t % period
    const hit = Math.exp(-since / 0.03)
    const bands = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const lift = i >= bandAt(40, n) && i <= bandAt(160, n) ? 40 * hit : i <= bandAt(2500, n) ? 10 * hit : 0
      bands[i] = -60 + lift + (r() - 0.5)
    }
    frames.push({ t, bands })
    t = (k + 1) / 60 + (jitter ? (r() - 0.5) * jitter : 0)
  }
  return frames
}

describe('beats', () => {
  it('finds a band by its frequency in sixths and twelfths', () => {
    expect(bandAt(1000, 61)).toBe(34)
    expect(bandAt(1000, 121)).toBe(68)
    expect([bandAt(40, 61), bandAt(160, 61), bandAt(2500, 61)]).toEqual([6, 18, 42])
    expect([bandAt(40, 121), bandAt(160, 121), bandAt(2500, 121)]).toEqual([12, 36, 84])
  })

  for (const [bpm, n] of [
    [120, 61],
    [93, 61],
    [128, 121],
  ]) {
    it(`hears every click of a ${bpm} BPM track and gives its tempo (${n} bands)`, () => {
      const beat = createBeat()
      const frames = clickTrack(bpm, 10, n)
      const onsets = frames.filter((f) => beat.push(f.bands, f.t).onset).map((f) => f.t)
      const clicks = Math.ceil(10 / (60 / bpm))
      expect(onsets.length).toBeGreaterThanOrEqual(clicks - 1)
      expect(onsets.length).toBeLessThanOrEqual(clicks)
      // Each on its click, within a frame.
      for (const t of onsets) {
        const off = t % (60 / bpm)
        expect(Math.min(off, 60 / bpm - off)).toBeLessThan(1 / 60 + 1e-9)
      }
      const tempo = beat.tempo()!
      expect(Math.abs(tempo.bpm - bpm)).toBeLessThan(1.5)
      expect(tempo.confidence).toBeGreaterThan(0.3)
    })
  }

  it('keeps the tempo when frames come unevenly', () => {
    const beat = createBeat()
    for (const f of clickTrack(120, 10, 61, 0.008)) beat.push(f.bands, f.t)
    expect(Math.abs(beat.tempo()!.bpm - 120)).toBeLessThan(2)
  })

  it('waits for a few seconds before it gives a tempo', () => {
    const beat = createBeat()
    for (const f of clickTrack(120, 2)) beat.push(f.bands, f.t)
    expect(beat.tempo()).toBeNull()
  })

  it('hears no beat in hiss or silence', () => {
    const r = random(3)
    const hiss = createBeat()
    let onsets = 0
    for (let k = 0; k < 600; k++) {
      const bands = Float32Array.from({ length: 61 }, () => -50 + 6 * (r() - 0.5))
      if (hiss.push(bands, k / 60).onset) onsets++
    }
    expect(onsets).toBe(0)
    expect(hiss.tempo()?.confidence ?? 0).toBeLessThan(0.3)
    const quiet = createBeat()
    for (let k = 0; k < 600; k++) expect(quiet.push(new Float32Array(61).fill(-120), k / 60).onset).toBe(false)
    expect(quiet.tempo()).toBeNull()
  })

  it('starts over after a reset', () => {
    const beat = createBeat()
    for (const f of clickTrack(120, 10)) beat.push(f.bands, f.t)
    beat.reset()
    expect(beat.tempo()).toBeNull()
  })
})
