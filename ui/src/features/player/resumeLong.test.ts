import { afterEach, expect, it, vi } from 'vitest'
import { usePlayer } from './store'
import { startResume } from './resumeLong'

const HOUR = 3_600_000
const kept = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) })
afterEach(() => kept.clear())

it('picks a long song up where it was left, also when that same song is played again', () => {
  kept.set('legato.resume', JSON.stringify({ 't:5': { ms: 40 * 60_000, at: 1 } }))
  const seek = vi.fn()
  usePlayer.setState({ seek, now: undefined, playing: false })
  const off = startResume()
  const book = () => ({ title: 'Book', artist: 'Reader', trackId: 5, via: 'local' as const, path: 'C:/book.m4b' })
  usePlayer.setState({ now: book(), durationMs: HOUR, positionMs: 0, playing: true })
  expect(seek).toHaveBeenLastCalledWith(40 * 60_000)
  // Paused there, then started again from its row: it is still the song playing.
  usePlayer.setState({ positionMs: 41 * 60_000, playing: false })
  seek.mockClear()
  usePlayer.setState({ now: book(), positionMs: 0, playing: true })
  expect(seek).toHaveBeenLastCalledWith(41 * 60_000)
  off()
})
