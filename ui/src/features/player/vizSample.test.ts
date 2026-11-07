import { describe, expect, it } from 'vitest'
import { sampleFrame } from './vizSample'
import { VIZ_BANDS, VIZ_FINE, VIZ_WAVE } from './vizUnpack'

describe('sampleFrame', () => {
  it('has the frames’ sizes, levels in dB below full scale, waves within -1 to 1', () => {
    for (const fine of [false, true]) {
      const f = sampleFrame(1.3, fine)
      expect(f.l.length).toBe(fine ? VIZ_FINE : VIZ_BANDS)
      expect(f.r.length).toBe(f.l.length)
      for (const v of [...f.l, ...f.r, ...f.rms, ...f.peak]) expect(v).toBeGreaterThan(-120)
      for (const v of [...f.l, ...f.r, ...f.rms, ...f.peak]) expect(v).toBeLessThan(0)
      expect(f.w[0].length).toBe(VIZ_WAVE)
      for (const v of [...f.w[0], ...f.w[1]]) expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })

  it('moves with time and is louder in the lows on the beat', () => {
    expect(sampleFrame(0).l[0]).toBeGreaterThan(sampleFrame(0.4).l[0])
    expect(sampleFrame(0).l[30]).not.toBe(sampleFrame(0.3).l[30])
  })
})
