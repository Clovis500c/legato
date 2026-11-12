import { expect, it } from 'vitest'
import { chapterAt, chapterEnd } from './chapters'

const book = [{ startMs: 0 }, { startMs: 60_000 }, { startMs: 90_000 }]

it('finds the chapter at a time, and where it ends', () => {
  expect([0, 59_999, 60_000, 89_999, 1_000_000].map((t) => chapterAt(book, t))).toEqual([0, 0, 1, 1, 2])
  expect(chapterAt([{ startMs: 5_000 }], 1_000)).toBe(-1)
  expect(chapterAt([], 1)).toBe(-1)
  expect([chapterEnd(book, 10), chapterEnd(book, 70_000), chapterEnd(book, 95_000), chapterEnd([], 5)]).toEqual([60_000, 90_000, null, null])
})
