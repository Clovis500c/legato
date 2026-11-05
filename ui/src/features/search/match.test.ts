import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { correct, distance, searchForm, tierOf, wordsOf } from './match'

const t = (id: number, title: string, artist: string): LibraryTrack => ({ id, added: id, addedAt: null, title, artist, album: null, durationMs: null, isrc: null, ids: { youtube: `y${id}` } })

describe('searchForm', () => {
  it('folds accents and case, drops apostrophes, reads & and + as and, other marks as spaces', () => {
    expect(searchForm("Don’t Stop Me Now")).toBe('dont stop me now')
    expect(searchForm('AC/DC')).toBe('ac dc')
    expect(searchForm('Simon & Garfunkel')).toBe('simon and garfunkel')
    expect(searchForm('Florence + the Machine')).toBe('florence and the machine')
    expect(searchForm('  Beyoncé — “Halo” (Live) ')).toBe('beyonce halo live')
    expect(wordsOf(' "Mr. Brightside" ')).toEqual(['mr', 'brightside'])
    expect(wordsOf(' - ')).toEqual([])
  })
})

describe('distance', () => {
  it('counts edits, a swap of two letters as one, and stops past the max', () => {
    expect(distance('beatels', 'beatles', 1)).toBe(1)
    expect(distance('metalica', 'metallica', 2)).toBe(1)
    expect(distance('kitten', 'sitting', 3)).toBe(3)
    expect(distance('kitten', 'sitting', 1)).toBe(2)
    expect(distance('abc', 'abc', 1)).toBe(0)
    expect(distance('a', 'abcd', 1)).toBe(2)
  })
})

it('tierOf: the name itself, its start, a word of it, elsewhere', () => {
  expect([tierOf('adele', 'adele'), tierOf('adele', 'ad'), tierOf('daft punk', 'punk'), tierOf('daft punk', 'unk')]).toEqual([3, 2, 1, 0])
})

describe('correct', () => {
  const lib = [t(1, 'Hey Jude', 'The Beatles'), t(2, 'Let It Be', 'The Beatles'), t(3, 'Beater', 'Someone'), t(4, 'Enter Sandman', 'Metallica')]
  it('swaps a word found nowhere for the closest one, the most used on a tie', () => {
    expect(correct(lib, ['beatels'])).toEqual(['beatles'])
    // Half typed: the start of a word counts.
    expect(correct(lib, ['beatel'])).toEqual(['beatles'])
    expect(correct(lib, ['metalica', 'sandman'])).toEqual(['metallica', 'sandman'])
  })
  it('leaves known and short words, gives up on a word with nothing close', () => {
    expect(correct(lib, ['jude'])).toBeNull()
    expect(correct(lib, ['xyz'])).toBeNull()
    expect(correct(lib, ['beatels', 'qqqqq'])).toBeNull()
  })
})
