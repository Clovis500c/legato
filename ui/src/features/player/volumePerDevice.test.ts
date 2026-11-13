import { describe, expect, it } from 'vitest'
import { remember, step } from './volumePerDevice'

describe('volume per output device', () => {
  it('brings a device its volume back, and gives a new one the volume it arrives at', () => {
    const m = { Speakers: 0.8 }
    expect(step(m, 'Speakers', 'Headset', 0.3, 0.3)).toEqual({ memory: m, set: 0.8 })
    expect(step(m, 'Headset', 'Speakers', 0.8, 0.8)).toEqual({ memory: { Speakers: 0.8, Headset: 0.8 } })
  })
  it('keeps a change under the device in use, and leaves mute alone', () => {
    expect(step({ A: 0.5 }, 'A', 'A', 0.6, 0.5).memory).toEqual({ A: 0.6 })
    expect(step({ A: 0.5 }, 'A', 'A', 0, 0.5).memory).toEqual({ A: 0.5 })
    expect(step({ A: 0.5, B: 0.2 }, 'A', 'B', 0, 0.2)).toEqual({ memory: { A: 0.5, B: 0.2 } })
  })
  it('forgets the oldest past fifty', () => {
    let m = {}
    for (let i = 0; i < 60; i++) m = remember(m, `d${i}`, 0.5)
    expect(Object.keys(m)).toHaveLength(50)
    expect(Object.keys(m)[0]).toBe('d10')
  })
})
