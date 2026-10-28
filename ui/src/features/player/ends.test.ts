import { describe, expect, it } from 'vitest'
import { rememberEnd, songEnd } from './ends'

describe('early ends', () => {
  it('ends a video where its song ended, never past the video', () => {
    expect(songEnd('aaaaaaaaaaa', 200_000)).toBe(200_000)
    rememberEnd('aaaaaaaaaaa', 197.04)
    expect(songEnd('aaaaaaaaaaa', 200_000)).toBe(197_000)
    // Another upload's length (shorter than the learned end): the video's own.
    expect(songEnd('aaaaaaaaaaa', 150_000)).toBe(150_000)
    expect(songEnd(undefined, 200_000)).toBe(200_000)
  })

  it('ignores impossible ends', () => {
    rememberEnd('bbbbbbbbbbb', Number.NaN)
    rememberEnd('bbbbbbbbbbb', 0)
    expect(songEnd('bbbbbbbbbbb', 100_000)).toBe(100_000)
  })
})
