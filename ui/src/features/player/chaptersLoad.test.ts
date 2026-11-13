import { expect, it, vi } from 'vitest'
import { create } from 'zustand'

const youtubeChapters = vi.fn(async () => [{ startMs: 0, title: 'A' }])
const player = create<{ now: { via: string; youtubeId: string } | null; durationMs: number | null }>(() => ({ now: null, durationMs: null }))
vi.mock('../../app/settings', () => ({ useSettings: { getState: () => ({ settings: { youtubeChapters: true } }) } }))
vi.mock('../../shared/api', () => ({ api: { youtubeChapters, trackChapters: vi.fn() } }))
vi.mock('./store', () => ({ usePlayer: player }))
const { startChapters } = await import('./chaptersLoad')

it("asks for a video's chapters once its length is known, even when it comes after the video starts", () => {
  const stop = startChapters()
  player.setState({ now: { via: 'youtube', youtubeId: 'abcdefghijk' }, durationMs: null })
  expect(youtubeChapters).not.toHaveBeenCalled()
  player.setState({ durationMs: 60 * 60_000 })
  player.setState({ durationMs: 60 * 60_000 + 1 })
  expect(youtubeChapters).toHaveBeenCalledOnce()
  // A short one is never asked.
  player.setState({ now: { via: 'youtube', youtubeId: 'bbbbbbbbbbb' }, durationMs: null })
  player.setState({ durationMs: 3 * 60_000 })
  expect(youtubeChapters).toHaveBeenCalledOnce()
  stop()
})
