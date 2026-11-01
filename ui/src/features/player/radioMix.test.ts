import { describe, expect, it } from 'vitest'
import { radioName, radioQueue, radioSeeds, shuffled } from './radioMix'

const song = (id: number, youtube = true, album: string | null = 'Animals', artist = 'Pink Floyd') => ({ id, ids: youtube ? { youtube: `v${id}` } : {}, album, artist })

describe('radio seeds', () => {
  it('leads with the most played song YouTube can start from, the other most played before it', () => {
    const plays: Record<number, number> = { 1: 2, 2: 9, 3: 5, 4: 7 }
    // Song 2, most played, is a local file: song 4 leads.
    const seeds = radioSeeds([song(1), song(2, false), song(3), song(4)], (t) => plays[t.id], 3)
    expect(seeds.map((t) => t.id)).toEqual([3, 2, 4])
  })

  it('keeps the set’s order when nothing was played, and leads with a file when nothing else can', () => {
    expect(radioSeeds([song(1), song(2), song(3)], () => 0).at(-1)?.id).toBe(1)
    expect(radioSeeds([song(1, false), song(2, false)], () => 0).map((t) => t.id)).toEqual([2, 1])
    expect(radioSeeds([], () => 0)).toEqual([])
  })
})

describe('radio queue', () => {
  it('mixes the set’s own songs in, one in three, after its first song', () => {
    expect(radioQueue('F', ['s1', 's2', 's3', 's4', 's5'], ['o1', 'o2', 'o3'])).toEqual(['F', 's1', 's2', 'o1', 's3', 's4', 'o2', 's5'])
    expect(radioQueue('F', ['s1'], [])).toEqual(['F', 's1'])
  })
})

describe('radio name', () => {
  it('is the album, else the artist, else none', () => {
    expect(radioName([song(1), song(2, true, 'animals ')])).toBe('Animals')
    expect(radioName([song(1), song(2, true, 'The Wall', 'Pink Floyd feat. Someone')])).toBe('Pink Floyd')
    // A compilation's page: its album.
    expect(radioName([song(1), song(2, true, 'Animals', 'Someone else')])).toBe('Animals')
    expect(radioName([song(1), song(2, true, 'The Wall', 'Someone else')])).toBeUndefined()
    expect(radioName([])).toBeUndefined()
  })
})

it('shuffles every song in, once', () => {
  let n = 0
  const rand = () => [0.9, 0.1, 0.5][n++ % 3]
  const out = shuffled([1, 2, 3, 4, 5], rand)
  expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  expect(out).not.toEqual([1, 2, 3, 4, 5])
})
