import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The true peak of live.js (the block between tp:begin and tp:end). Its Rust twin: crates/dsp/src/meter.rs.
const src = readFileSync(new URL('./live.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// tp:begin'), src.indexOf('// tp:end'))
const { TP, truePeak } = new Function(`${block}; return { TP, truePeak }`)() as { TP: number[][]; truePeak: (x: ArrayLike<number>) => number }

describe('true peak', () => {
  it('filters with the native meter’s taps', () => {
    const rust = readFileSync(new URL('../../dsp/src/meter.rs', import.meta.url), 'utf8')
    const from = rust.indexOf('= [', rust.indexOf('const TRUE_PEAK'))
    const taps = [...rust.slice(from, rust.indexOf('];', from)).matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]))
    expect(taps).toHaveLength(48)
    expect(taps).toEqual(TP.flat())
  })

  it('finds the crests between samples: a quarter of the rate, 45° off', () => {
    const x = Float32Array.from({ length: 2048 }, (_, n) => 0.5 * Math.sin((Math.PI / 2) * n + Math.PI / 4))
    expect(Math.max(...x)).toBeCloseTo(0.354, 3)
    expect(truePeak(x)).toBeCloseTo(0.5, 2)
  })

  it('is never under the sample peak; a tone reads its amplitude, silence nothing', () => {
    const click = new Float32Array(64)
    click[3] = 0.8
    expect(truePeak(click)).toBeGreaterThanOrEqual(0.8)
    const tone = Float32Array.from({ length: 2048 }, (_, n) => 0.25 * Math.sin((2 * Math.PI * 997 * n) / 48000))
    expect(truePeak(tone)).toBeCloseTo(0.25, 2)
    expect(truePeak(new Float32Array(2048))).toBe(0)
  })
})
