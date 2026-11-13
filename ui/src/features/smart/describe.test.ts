import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { describePlaylist } from './describe'

const song = (id: number, artist: string, genre?: string): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album: null, durationMs: null, isrc: null, ids: {}, genre })
const library = [song(1, 'Daft Punk', 'Electronic'), song(2, 'Miles Davis', 'Jazz'), song(3, 'Nina Simone', 'Jazz'), song(4, 'Fela', 'Hip Hop')]
const rules = (text: string) => describePlaylist(text, library)

describe('describePlaylist', () => {
  it('reads decades, years, tempo and what is new', () => {
    expect(rules('90s')?.rules).toEqual([{ field: 'year', op: 'atLeast', value: '1990' }, { field: 'year', op: 'atMost', value: '1999' }])
    expect(rules('songs of the eighties')?.rules.map((r) => r.value)).toEqual(['1980', '1989'])
    expect(rules("'00s")?.rules.map((r) => r.value)).toEqual(['2000', '2009'])
    expect(rules('1995')?.rules.map((r) => r.value)).toEqual(['1995', '1995'])
    expect(rules('fast workout')?.rules).toEqual([{ field: 'tempo', op: 'atLeast', value: '120' }])
    expect(rules('calm and chill')?.rules).toEqual([{ field: 'tempo', op: 'atMost', value: '95' }])
    const fresh = rules('new songs')
    expect([fresh?.rules, fresh?.sort]).toEqual([[{ field: 'added', op: 'last', value: '50' }], 'added'])
  })

  it('finds the library genres and artists named', () => {
    expect(rules('calm jazz from the 60s')?.rules.map((r) => `${r.field}:${r.op}:${r.value}`)).toEqual(['tempo:atMost:95', 'year:atLeast:1960', 'year:atMost:1969', 'genre:has:Jazz'])
    expect(rules('hip hop')?.rules).toEqual([{ field: 'genre', op: 'has', value: 'Hip Hop' }])
    // An artist, whole and in any case; a part of a name is not the artist.
    expect(rules('daft punk')?.rules).toEqual([{ field: 'artist', op: 'is', value: 'Daft Punk' }])
    expect(rules('punk')).toBeNull()
  })

  it('any of several artists or genres alone, one of each beside other rules', () => {
    const two = rules('Miles Davis and Nina Simone')
    expect([two?.match, two?.rules.length]).toEqual(['any', 2])
    const mixed = rules('Miles Davis, Nina Simone, 60s')
    expect([mixed?.match, mixed?.rules.map((r) => r.field)]).toEqual(['all', ['artist', 'year', 'year']])
    expect(rules('jazz electronic')?.match).toBe('any')
  })

  it('says the words it did not understand, and nothing when none meant a rule', () => {
    expect(rules('rainy sunday jazz')?.left).toEqual(['rainy', 'sunday'])
    expect(rules('rainy sunday')).toBeNull()
    expect(rules('')).toBeNull()
  })
})

it('asks for English words in every language: only those make rules', () => {
  const locales = import.meta.glob<Record<string, string>>('../../shared/i18n/locales/*.ts', { eager: true, import: 'default' })
  const asks = ['Describe the playlist: a decade, a genre of your library, calm or fast, new…', 'No rule found in these words. Try a decade, a genre or artist of your library, calm or fast, new…']
  for (const [path, words] of Object.entries(locales)) for (const ask of asks) for (const w of ['calm', 'fast', 'new']) expect(words[ask], `${path}: ${w}`).toContain(w)
  expect(Object.keys(locales).length).toBe(19)
  expect(['calm', 'fast', 'new'].map((w) => rules(w)?.rules.length)).toEqual([1, 1, 1])
})
