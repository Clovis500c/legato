import { describe, expect, it } from 'vitest'
import { offerEnd, rememberEnd, rememberStart, songEnd, songStart } from './ends'

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

describe('skip silence', () => {
  it('a local file ends where the engine measured, through the same path as a video', () => {
    expect(songEnd('local:C:/a.mp3', 200_000)).toBe(200_000)
    offerEnd('local:C:/a.mp3', 190.04)
    expect(songEnd('local:C:/a.mp3', 200_000)).toBe(190_000)
    // Setting off or nothing to cut: whole file again.
    offerEnd('local:C:/a.mp3', null)
    expect(songEnd('local:C:/a.mp3', 200_000)).toBe(200_000)
  })

  it('remembers where the music of a video starts', () => {
    expect(songStart('ccccccccccc')).toBe(0)
    rememberStart('ccccccccccc', 5.04)
    expect(songStart('ccccccccccc')).toBe(5)
    rememberStart('ccccccccccc', Number.NaN)
    expect(songStart('ccccccccccc')).toBe(5)
    expect(songStart(undefined)).toBe(0)
  })
})
