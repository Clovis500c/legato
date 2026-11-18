import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The context choices of live.js (the block between ctx:begin and ctx:end).
const src = readFileSync(new URL('./live.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// ctx:begin'), src.indexOf('// ctx:end'))
const { contextOptions, analysis } = new Function(`${block}; return { contextOptions, analysis }`)() as {
  contextOptions: (listenOnly: boolean) => Record<string, unknown>
  analysis: (phone: boolean) => { fft: number; every: number }
}

describe('audio context', () => {
  it('listening only asks for no output device; processing keeps its device', () => {
    expect(contextOptions(true)).toEqual({ latencyHint: 'playback', sinkId: { type: 'none' } })
    expect(contextOptions(false)).toEqual({ latencyHint: 'playback' })
  })
  it('the phone reads half as often, through windows that still leave no gap; the desktop is as before', () => {
    expect(analysis(false)).toEqual({ fft: 2048, every: 1 })
    const { fft, every } = analysis(true)
    // 33 ms per tick at the lowest usual rate (44.1 kHz): the window covers the span between two reads.
    expect(fft / 44100).toBeGreaterThanOrEqual((every * 33) / 1000)
  })
})

// The levels' smoothing of live.js (the block between lv:begin and lv:end).
const lv = src.slice(src.indexOf('// lv:begin'), src.indexOf('// lv:end'))
type Levels = { elapsed: number; momentary: number; short: number }
const smooth = new Function(`${lv}; return smooth`)() as (g: Levels, ms: number, span: number) => void
const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms)

describe('levels read every other tick', () => {
  it('land on the levels of a read every tick, on music that swells and drops', () => {
    const dt = 1 / 30
    // A read's mean square: a 2 s swell between -30 and -10 LUFS-ish, then a drop, 20 s in all.
    const at = (i: number) => {
      const t = i * dt
      return t < 12 ? 10 ** ((-20 + 10 * Math.sin(t * Math.PI)) / 10) : 10 ** (-4.5)
    }
    const desk: Levels = { elapsed: 0, momentary: 0, short: 0 }
    const phone: Levels = { elapsed: 0, momentary: 0, short: 0 }
    for (let i = 0; i < 600; i++) {
      smooth(desk, at(i), dt)
      // The phone's longer window holds both ticks' samples: their mean.
      if (i % 2) smooth(phone, (at(i - 1) + at(i)) / 2, 2 * dt)
      if (i % 2 && i > 30) {
        expect(Math.abs(lufs(phone.short) - lufs(desk.short))).toBeLessThan(0.1)
        expect(Math.abs(lufs(phone.momentary) - lufs(desk.momentary))).toBeLessThan(0.6)
      }
    }
  })
})
