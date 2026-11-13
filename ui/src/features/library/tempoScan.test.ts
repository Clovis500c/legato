import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTempoScan } from './tempoScan'

describe('tempo estimation schedule', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits two minutes, goes on every 15 s while songs wait, then rests', async () => {
    const left = [2, 0]
    const scan = vi.fn(async () => left.shift() ?? 0)
    const stop = startTempoScan(() => true, scan)
    await vi.advanceTimersByTimeAsync(119_000)
    expect(scan).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(scan).toHaveBeenCalledWith(3)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(scan).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(scan).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does nothing while off, and stops for good when cleaned up', async () => {
    const scan = vi.fn(async () => 0)
    let on = false
    const stop = startTempoScan(() => on, scan)
    await vi.advanceTimersByTimeAsync(130_000)
    expect(scan).not.toHaveBeenCalled()
    stop()
    on = true
    await vi.advanceTimersByTimeAsync(3 * 3_600_000)
    expect(scan).not.toHaveBeenCalled()
  })
})
