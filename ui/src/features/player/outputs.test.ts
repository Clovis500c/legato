import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: (string | null)[] = []
vi.mock('../../shared/api', () => ({
  api: {
    outputDevices: () => Promise.resolve({ names: ['Speakers', 'Headphones'], current: 'Speakers' }),
    setOutputDevice: (n: string | null) => (calls.push(n), n === 'Gone' ? Promise.reject(new Error('gone')) : Promise.resolve()),
  },
}))
const { chooseOutput, refreshOutputs, useOutputs } = await import('./outputs')
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('output device', () => {
  beforeEach(() => (calls.length = 0, useOutputs.setState({ names: [], current: null })))
  it('lists the devices and the one picked', async () => {
    refreshOutputs()
    await tick()
    expect(useOutputs.getState()).toMatchObject({ names: ['Speakers', 'Headphones'], current: 'Speakers' })
  })
  it('keeps a pick that worked, and asks again after one that failed', async () => {
    chooseOutput('Headphones')
    await tick()
    expect(useOutputs.getState().current).toBe('Headphones')
    chooseOutput('Gone')
    await tick()
    expect(calls).toEqual(['Headphones', 'Gone'])
    expect(useOutputs.getState().current).toBe('Speakers')
  })
})
