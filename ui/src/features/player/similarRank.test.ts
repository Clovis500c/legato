import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { featuresOf, pickSimilar, profileOf, type Candidate, type Taste } from './similarRank'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }))

const song = (id: number, artist: string, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album: null, durationMs: null, isrc: null, ids: {}, ...extra })
const none: Taste = { rating: () => 0, plays: () => 0 }
const ids = (l: LibraryTrack[]) => l.map((t) => t.id)
const cands = (l: LibraryTrack[]): Candidate[] => l.map((track) => ({ track }))

describe('similar songs ranked by the whole queue', () => {
  // A queue of rock, mostly by Alpha; the last song played is a jazz one.
  const queue = [song(1, 'Alpha', { genre: 'rock', year: 1995 }), song(2, 'Alpha', { genre: 'rock', year: 1996 }), song(3, 'Beta', { genre: 'rock', year: 1997 }), song(4, 'Gamma', { genre: 'jazz', year: 1960 })]
  const rock = song(10, 'Delta', { genre: 'rock', year: 1996 })
  const jazz = song(11, 'Epsilon', { genre: 'jazz', year: 1961 })
  const alpha = song(12, 'Alpha', { genre: 'rock', year: 1994 })

  it('the queue as a whole decides, not the last song: rock outranks the jazz the last song was', () => {
    const [first] = pickSimilar(cands([jazz, rock]), queue, 3, none, 'alike', 1)
    expect(first.id).toBe(rock.id)
    // The profile counts the recent more: the last song's artist and genre are in it, but lighter than three rock songs together.
    const p = profileOf(queue, 3, none)
    expect(p.get('g:rock')!).toBeGreaterThan(p.get('g:jazz')!)
  })

  it('a song you rated high comes first, one you rated 1-2 never', () => {
    const taste: Taste = { rating: (t) => (t.id === jazz.id ? 10 : t.id === rock.id ? 1 : 0), plays: () => 0 }
    const out = pickSimilar(cands([rock, jazz, alpha]), queue, 3, taste, 'alike', 3)
    expect(out[0].id).toBe(jazz.id)
    expect(ids(out)).not.toContain(rock.id)
  })

  it('what is already in the queue never comes back, nor a song asked twice', () => {
    const out = pickSimilar(cands([queue[0], rock, rock, jazz]), queue, 3, none, 'balanced', 5)
    expect(ids(out).sort()).toEqual([rock.id, jazz.id].sort())
  })

  it('never the same artist three times running, even when it scores best', () => {
    const lots = [20, 21, 22, 23].map((i) => song(i, 'Alpha', { genre: 'rock', year: 1995 }))
    const others = [rock, jazz, song(40, 'Eta', { genre: 'rock' }), song(41, 'Theta', { genre: 'rock' })]
    const out = pickSimilar(cands([...lots, ...others]), [queue[0], queue[1]], 1, none, 'alike', 6)
    const artists = [queue[0].artist, queue[1].artist, ...out.map((t) => t.artist)]
    for (let i = 2; i < artists.length; i++) expect(new Set([artists[i - 2], artists[i - 1], artists[i]]).size).toBeGreaterThan(1)
    // And the queue's own two Alpha songs count in the run: the first pick is not Alpha either.
    expect(out[0].artist).not.toBe('Alpha')
  })

  it('the rules hold however far ahead a song scores: no third artist in a row, no song rated 1-2', () => {
    const fan = (id: number) => song(id, 'Omega', { album: 'Best', genre: 'pop', year: 2001, bpm: 120, key: 'C' })
    const queue30 = Array.from({ length: 30 }, (_, i) => fan(100 + i))
    const taste: Taste = { rating: (t) => (t.id === 200 ? 1 : t.artist === 'Omega' ? 10 : 0), plays: () => 1000 }
    const out = pickSimilar(cands([fan(200), fan(201), fan(202), song(300, 'Other'), song(301, 'Else')]), queue30, 29, taste, 'alike', 4)
    expect(ids(out)).not.toContain(200)
    expect(out[0].artist).not.toBe('Omega')
  })

  it('a radio’s answer order counts, and its first song beats its last', () => {
    const radio: Candidate[] = [song(30, 'Zed'), song(31, 'Yan'), song(32, 'Xi')].map((track, rank) => ({ track, rank }))
    expect(ids(pickSimilar(radio, [song(99, 'Other')], 0, none, 'alike', 3))).toEqual([30, 31, 32])
  })

  it('Adventurous takes more from the middle of the ranking than Alike', () => {
    const pool = Array.from({ length: 20 }, (_, i) => song(100 + i, `Artist ${i}`, { genre: i < 10 ? 'rock' : 'folk' }))
    const top = pickSimilar(cands(pool), queue, 2, none, 'alike', 10)
    const wide = pickSimilar(cands(pool), queue, 2, none, 'adventurous', 10)
    const folk = (l: LibraryTrack[]) => l.filter((t) => t.genre === 'folk').length
    expect(folk(wide)).toBeGreaterThan(folk(top))
    // Both are deterministic: the same answer twice.
    expect(ids(pickSimilar(cands(pool), queue, 2, none, 'adventurous', 10))).toEqual(ids(wide))
  })

  it('features: main artist, album, genre, decade, tempo and key', () => {
    expect(featuresOf(song(1, 'A feat. B', { album: 'Rec', genre: 'Rock', year: 1999, bpm: 118, key: 'Am' })).map(([f]) => f)).toEqual(['a:a', 'al:rec', 'g:rock', 'y:199', 'b:12', 'k:am'])
  })
})
