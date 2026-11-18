import { expect, it, vi } from 'vitest'
import { create } from 'zustand'

const youtubeChapters = vi.fn(async () => [{ startMs: 0, title: 'A' }])
const player = create<{ now: { via: string; youtubeId: string; trackId?: number } | null; durationMs: number | null }>(() => ({ now: null, durationMs: null }))
vi.mock('../../app/settings', () => ({ useSettings: { getState: () => ({ settings: { youtubeChapters: true } }) } }))
vi.mock('../../shared/api', () => ({ api: { youtubeChapters, trackChapters: vi.fn() } }))
const splitIntoParts = vi.fn()
vi.mock('./store', () => ({ usePlayer: player, splitIntoParts }))
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

it("a video's answer splits it into its parts in Up next; its parts playing on ask nothing again and keep the menu", async () => {
  const { useChapters } = await import('./chapters')
  youtubeChapters.mockClear()
  const stop = startChapters()
  player.setState({ now: { via: 'youtube', youtubeId: 'ccccccccccc', trackId: 4 }, durationMs: 60 * 60_000 })
  await new Promise((r) => setTimeout(r))
  expect(splitIntoParts).toHaveBeenCalledWith('ccccccccccc', [{ startMs: 0, title: 'A' }])
  // The rows of its parts (their own ids), the same video.
  player.setState({ now: { via: 'youtube', youtubeId: 'ccccccccccc', trackId: -9 } })
  player.setState({ now: { via: 'youtube', youtubeId: 'ccccccccccc', trackId: -10 } })
  expect(youtubeChapters).toHaveBeenCalledOnce()
  expect(useChapters.getState().list).toEqual([{ startMs: 0, title: 'A' }])
  stop()
})
