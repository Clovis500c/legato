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
