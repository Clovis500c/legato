import { describe, expect, it, vi } from 'vitest'
import { remember, step } from './volumePerDevice'

describe('volume per output device', () => {
  it('brings a device its volume back, and gives a new one the volume it arrives at', () => {
    const m = { Speakers: 0.8 }
    expect(step(m, 'Speakers', 'Headset', 0.3, 0.3)).toEqual({ memory: { Speakers: 0.8, Headset: 0.3 }, set: 0.8 })
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

describe('the volume following the device picked', () => {
  it('brings a device its volume back when it is picked again, and stops when cleaned up', async () => {
    vi.resetModules()
    vi.doMock('../../shared/api', () => ({ api: { outputDevices: () => new Promise(() => {}) } }))
    const { startVolumePerDevice } = await import('./volumePerDevice')
    const { useOutputs } = await import('./outputs')
    const { usePlayer } = await import('./store')
    const set = vi.fn()
    usePlayer.setState({ volume: 0.8, setVolume: set })
    useOutputs.setState({ current: null })
    const stop = startVolumePerDevice(() => true)
    // Headphones, first seen: they take the volume they arrive at; then the user turns them down.
    useOutputs.setState({ current: 'Headphones' })
    usePlayer.setState({ volume: 0.3 })
    // Back to the system's default: its 0.8 comes back.
    useOutputs.setState({ current: null })
    expect(set).toHaveBeenCalledWith(0.8)
    stop()
    set.mockClear()
    useOutputs.setState({ current: 'Headphones' })
    expect(set).not.toHaveBeenCalled()
  })
})
