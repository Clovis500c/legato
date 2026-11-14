import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TasteSignal } from '../../shared/api'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn(async () => undefined) }))

const signal = (id: number, extra: Partial<TasteSignal> = {}): TasteSignal => ({ id, playsDecayed: 0, playsLong: 0, lastPlayed: 0, skipsRecent: 0, liked: false, less: false, never: false, ...extra })

describe('the taste store', () => {
  beforeEach(() => vi.resetModules())

  it('loads at start, keeps the answer by id, and keeps the old one when a load fails', async () => {
    const { loadTaste, useTaste } = await import('./taste')
    expect(useTaste.getState().loaded).toBe(false)
    await loadTaste(async () => [signal(1, { never: true }), signal(2, { skipsRecent: 3 })])
    expect(useTaste.getState().loaded).toBe(true)
    expect(useTaste.getState().signals.get(1)?.never).toBe(true)
    expect(useTaste.getState().signals.get(9)).toBeUndefined()
    await loadTaste(async () => Promise.reject(new Error('x')))
    expect(useTaste.getState().signals.get(2)?.skipsRecent).toBe(3)
  })

  it('loads again every 20 listens, not before', async () => {
    const { startTaste, RELOAD_EVERY } = await import('./taste')
    const { startListen, endListen } = await import('./listens')
    const ask = vi.fn(async () => [signal(1)])
    const stop = startTaste(ask)
    expect(ask).toHaveBeenCalledTimes(1)
    const listen = () => {
      startListen(1, 200_000)
      endListen(true)
    }
    for (let i = 0; i < RELOAD_EVERY - 1; i++) listen()
    expect(ask).toHaveBeenCalledTimes(1)
    listen()
    expect(ask).toHaveBeenCalledTimes(2)
    stop()
    for (let i = 0; i < RELOAD_EVERY; i++) listen()
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
