import { expect, it } from 'vitest'
import { toPlay } from './listens'

const listen = (heardMs: number, lastMs: number, durationMs: number | null = 200_000) => ({ trackId: 1, startedAt: 100, heardMs, lastMs, durationMs })

it('records completes, skips, ignores stray clicks', () => {
  expect(toPlay(listen(500, 500), false)).toBeNull()
  expect(toPlay(listen(10_000, 10_000), false)).toMatchObject({ listenedMs: 10_000, completed: false })
  expect(toPlay(listen(500, 500), true)).toMatchObject({ completed: true })
  // Seeked near the end and listened out: complete.
  expect(toPlay(listen(20_000, 185_000), false)).toMatchObject({ completed: true })
  expect(toPlay(listen(20_000, 185_000, null), false)).toMatchObject({ completed: false })
})
