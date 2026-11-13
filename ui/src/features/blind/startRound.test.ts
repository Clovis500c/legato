import { expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { usePlayer } from '../player/store'
import { startRound } from './BlindTest'

it('a round plays its song from the snippet, the start given with the play', () => {
  const resume = vi.fn()
  usePlayer.setState({ resume })
  const song = { id: 7, title: 'S', artist: 'A', durationMs: 200_000, ids: { local: 'x' } } as unknown as LibraryTrack
  startRound(song)
  expect(resume).toHaveBeenCalledWith(expect.objectContaining({ list: [song], index: 0, positionMs: 60_000 }))
})
