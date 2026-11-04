import { describe, expect, it } from 'vitest'
import { correlation, CORR_S, easeCorrelation, vectorPoints } from './vizVector'
import { VIZ_WAVE } from './vizUnpack'

/** A side's wave block: 24 kHz (48 kHz, every two averaged). */
const sine = (hz: number, phase = 0, amp = 0.5) => Float32Array.from({ length: VIZ_WAVE }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 24_000 + phase))

describe('vectorscope', () => {
  it('stands mono up, leans one side 45°, lays opposite phases flat, never leaving the square', () => {
    const out = vectorPoints([0.5, 1, 0, 1], [0.5, 0, 1, -1], new Float32Array(8))
    expect([...out]).toEqual([0, 0.5, -0.5, 0.5, 0.5, 0.5, -1, 0])
    const l = [1, -1, 1, -0.25, 0.3]
    const r = [1, 1, -0.3, -1, 0.1]
    const p = vectorPoints(l, r, new Float32Array(10))
    for (let i = 0; i < l.length; i++) expect(Math.abs(p[2 * i]) + Math.abs(p[2 * i + 1])).toBeCloseTo(Math.max(Math.abs(l[i]), Math.abs(r[i])), 6)
  })

  it('reads +1 for mono, −1 for opposite phases, 0 for a quarter turn or one side alone, nothing in silence', () => {
    // 1.5 kHz: the block holds whole periods (16 samples each), so the quarter turn sums to 0.
    const a = sine(1500)
    expect(correlation(a, a)).toBeCloseTo(1, 6)
    expect(correlation(a, a.map((v) => -v))).toBeCloseTo(-1, 6)
    expect(correlation(a, sine(1500, Math.PI / 2))).toBeCloseTo(0, 6)
    expect(correlation(a, new Float32Array(VIZ_WAVE))).toBe(0)
    expect(correlation(new Float32Array(VIZ_WAVE), new Float32Array(VIZ_WAVE))).toBeNull()
    // Louder on one side, same shape: still +1.
    expect(correlation(a, a.map((v) => v / 4))).toBeCloseTo(1, 6)
  })

  it('reads unrelated noise near 0', () => {
    let seed = 7
    const noise = () => Float32Array.from({ length: 4096 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1)
    expect(Math.abs(correlation(noise(), noise())!)).toBeLessThan(0.05)
  })

  it('eases like a meter: about two thirds of the way in its time constant, held through silence', () => {
    expect(easeCorrelation(0, 1, CORR_S)).toBeCloseTo(1 - Math.exp(-1), 6)
    let shown = 1
    for (let t = 0; t < 2; t += 1 / 60) shown = easeCorrelation(shown, -1, 1 / 60)
    expect(shown).toBeLessThan(-0.99)
    expect(easeCorrelation(0.4, null, 1)).toBe(0.4)
  })
})
