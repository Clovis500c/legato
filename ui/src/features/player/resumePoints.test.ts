import { expect, it } from 'vitest'
import { LONG_MS, pointFor, withPoint } from './resumePoints'

const HOUR = 3_600_000

it('keeps the place in a long song and drops it near either end or in a short one', () => {
  const p = withPoint({}, 'f:book', 20 * 60_000, HOUR, 1)
  expect(p).toEqual({ 'f:book': { ms: 1_200_000, at: 1 } })
  expect(pointFor(p, 'f:book', HOUR)).toBe(1_200_000)
  // Another song: nothing. The same one now ending before that place (another cut): nothing.
  expect(pointFor(p, 'f:other', HOUR)).toBeNull()
  expect(pointFor(p, 'f:book', 1_210_000)).toBeNull()
  // Heard to the end (or back at the start): the point goes.
  expect(withPoint(p, 'f:book', HOUR - 10_000, HOUR, 2)).toEqual({})
  expect(withPoint(p, 'f:book', 5_000, HOUR, 2)).toEqual({})
  // A song under the limit never gets one.
  expect(withPoint({}, 'f:song', 60_000, LONG_MS - 1, 3)).toEqual({})
})

it('forgets the oldest places past 200 songs', () => {
  let p = {}
  for (let i = 0; i < 205; i++) p = withPoint(p, `f:${i}`, 60_000, HOUR, i)
  expect(Object.keys(p)).toHaveLength(200)
  expect(pointFor(p, 'f:0', HOUR)).toBeNull()
  expect(pointFor(p, 'f:204', HOUR)).toBe(60_000)
})
