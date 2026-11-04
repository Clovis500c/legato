import { describe, expect, it } from 'vitest'
import { monoWave, SPAN, trigger } from './vizScope'
import { VIZ_WAVE } from './vizUnpack'

/** A wave block as the frames carry it: 24 kHz (48 kHz, every two averaged). */
const block = (hz: number, phase: number, amp = 0.5) => Float32Array.from({ length: VIZ_WAVE }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 24_000 + phase))

describe('oscilloscope', () => {
  it('starts on a rising zero crossing, so a steady wave stands still whatever its phase', () => {
    const first = block(440, 0.3)
    const t0 = trigger(first)
    expect(first[t0 - 1]).toBeLessThan(0)
    expect(first[t0]).toBeGreaterThanOrEqual(-0.05)
    for (const phase of [1, 2, 3, 4, 5, 6]) {
      const x = block(440, phase)
      const t = trigger(x)
      expect(t + SPAN).toBeLessThanOrEqual(VIZ_WAVE)
      // The same picture within a sample's turn (440 Hz: 0.12 rad a sample).
      for (let k = 0; k < 60; k++) expect(Math.abs(x[t + k] - first[t0 + k])).toBeLessThan(0.07)
    }
  })

  it('is not tripped by hiss over a low tone, and draws from the start when nothing crosses', () => {
    const x = block(110, 2)
    for (let i = 0; i < x.length; i++) x[i] += i % 2 ? 0.02 : -0.02
    const t = trigger(x)
    expect(Math.abs(block(110, 2)[t])).toBeLessThan(0.05)
    expect(trigger(new Float32Array(VIZ_WAVE).fill(0.3))).toBe(0)
  })

  it('shows both sides as one', () => {
    const out = monoWave(Float32Array.of(1, 0.5), Float32Array.of(0, -0.5), new Float32Array(2))
    expect([...out]).toEqual([0.5, 0])
  })
})
