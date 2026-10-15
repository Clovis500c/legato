import { describe, expect, it } from 'vitest'
import { bestMatch, matchKey, mergeTracks, normalize, primaryArtist, sameTrack } from './match'
import type { Track } from './types'

const t = (p: Partial<Track>): Track => ({ title: 'Song', artist: 'Artist', ids: {}, ...p })

describe('normalize', () => {
  it.each([
    ['Get Lucky (feat. Pharrell Williams)', 'get lucky'],
    ['Get Lucky feat. Pharrell', 'get lucky'],
    ['Bohemian Rhapsody - Remastered 2011', 'bohemian rhapsody'],
    ['Bohemian Rhapsody (Official Video) [HD]', 'bohemian rhapsody'],
    ['Beyoncé', 'beyonce'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ['Feather', 'feather'],
    ['夜に駆ける', '夜に駆ける'],
    ['Live Forever (Live)', 'live forever live'],
  ])('%s → %s', (input, out) => expect(normalize(input)).toBe(out))
})

describe('primaryArtist', () => {
  it('garde le premier artiste', () => {
    expect(primaryArtist('Daft Punk, Pharrell Williams')).toBe('daft punk')
    expect(primaryArtist('Daft Punk ft. Pharrell')).toBe('daft punk')
    expect(primaryArtist('Calvin Harris x Dua Lipa')).toBe('calvin harris')
  })
  it('matchKey = titre|premier artiste', () => {
    expect(matchKey(t({ title: 'Song (Lyrics)', artist: 'Simon & Garfunkel' }))).toBe('song|simon')
  })
})

describe('sameTrack', () => {
  it('ISRC identiques (casse ignorée) = même morceau, même si les titres diffèrent', () => {
    expect(sameTrack(t({ isrc: 'USUM71703861', title: 'A' }), t({ isrc: 'usum71703861', title: 'B' }))).toBe(true)
  })
  it('ISRC différents = enregistrements différents', () => {
    expect(sameTrack(t({ isrc: 'GBAYE0601498' }), t({ isrc: 'GBAYE1100001' }))).toBe(false)
  })
  it('même id de source = même morceau', () => {
    expect(sameTrack(t({ ids: { spotify: 'x' }, title: 'A' }), t({ ids: { spotify: 'x' }, title: 'B' }))).toBe(true)
  })
  it('repli titre + artiste + durée quand un ISRC manque', () => {
    const spotify = t({ title: 'Get Lucky (feat. Pharrell Williams)', artist: 'Daft Punk, Pharrell Williams', durationMs: 248_000, isrc: 'USQX91300108' })
    const yt = t({ title: 'Get Lucky (Official Audio) ft. Pharrell Williams', artist: 'Daft Punk', durationMs: 250_000 })
    expect(sameTrack(spotify, yt)).toBe(true)
  })
  it('refuse si la durée diffère trop', () => {
    expect(sameTrack(t({ durationMs: 200_000 }), t({ durationMs: 260_000 }))).toBe(false)
  })
  it('accepte si une durée est inconnue', () => {
    expect(sameTrack(t({ durationMs: 200_000 }), t({}))).toBe(true)
  })
  it('refuse un autre artiste ou un autre titre', () => {
    expect(sameTrack(t({ artist: 'Adele' }), t({ artist: 'Muse' }))).toBe(false)
    expect(sameTrack(t({ title: 'Hello' }), t({ title: 'Hello (Live)' }))).toBe(false)
  })
})

describe('bestMatch', () => {
  it("préfère l'ISRC exact au premier candidat flou", () => {
    const fuzzy = t({ ids: { spotify: '1' } })
    const exact = t({ ids: { spotify: '2' }, isrc: 'FRZ111700001', title: 'Autre titre' })
    expect(bestMatch(t({ isrc: 'FRZ111700001' }), [fuzzy, exact])).toBe(exact)
  })
  it('repli flou sans ISRC, null si rien', () => {
    const c = t({ ids: { spotify: '1' } })
    expect(bestMatch(t({}), [t({ title: 'Nope' }), c])).toBe(c)
    expect(bestMatch(t({}), [t({ title: 'Nope' })])).toBeNull()
  })
})

it('mergeTracks garde les champs de a et complète avec b', () => {
  const m = mergeTracks(t({ ids: { youtube: 'y' }, durationMs: 1 }), t({ ids: { spotify: 's' }, isrc: 'X', album: 'Al', durationMs: 2 }))
  expect(m).toEqual(t({ ids: { youtube: 'y', spotify: 's' }, isrc: 'X', album: 'Al', durationMs: 1 }))
})
