import { expect, it, vi } from 'vitest'
import { create } from 'zustand'

const songEnds = vi.fn(async () => [])
type S = { now: { via: string } | null; list: { id: number }[]; index: number; order: number[]; repeat: 'off'; skipLong: number }
const player = create<S>(() => ({ now: null, list: [], index: 0, order: [], repeat: 'off', skipLong: 0 }))
vi.mock('../../shared/api', () => ({ api: { songEnds } }))
vi.mock('./store', () => ({ usePlayer: player, passOver: () => false }))
const { startSweetLoad } = await import('./sweetLoad')

it('asks for the song that really comes next, shuffled or not', () => {
  const stop = startSweetLoad(() => true)
  // Shuffled: after the first song (index 0) comes the third (index 2), not the second.
  player.setState({ now: { via: 'local' }, list: [{ id: 10 }, { id: 11 }, { id: 12 }], index: 0, order: [0, 2, 1] })
  expect(songEnds).toHaveBeenLastCalledWith([10, 12])
  stop()
})
