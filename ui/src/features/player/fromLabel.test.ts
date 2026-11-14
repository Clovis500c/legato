import { describe, expect, it } from 'vitest'
import { contextOf, FROM_KINDS, fromAria, type FromKind } from './fromLabel'

const playlists = [{ id: 4, name: 'Late piano' }, { id: 9, name: '' }]
const words = { songs: 'Songs' }

describe('the "From" label of Now Playing', () => {
  it('names the page a queue is started from, with its kind (and the playlist id for its cover)', () => {
    expect(contextOf({ name: 'playlist', id: 4 }, playlists, words)).toEqual({ from: 'Late piano', kind: 'playlist', id: 4 })
    expect(contextOf({ name: 'album', album: 'Low Tide Radio', artist: 'Halden Marsh' }, playlists, words)).toEqual({ from: 'Low Tide Radio', kind: 'album' })
    expect(contextOf({ name: 'artist', artist: 'Halden Marsh' }, playlists, words)).toEqual({ from: 'Halden Marsh', kind: 'artist' })
    expect(contextOf({ name: 'songs' }, playlists, words)).toEqual({ from: 'Songs', kind: 'songs' })
  })

  it('has none for other pages, a deleted playlist or a nameless one', () => {
    expect(contextOf({ name: 'home' }, playlists, words)).toBeUndefined()
    expect(contextOf({ name: 'mixes' }, playlists, words)).toBeUndefined()
    expect(contextOf({ name: 'playlist', id: 77 }, playlists, words)).toBeUndefined()
    expect(contextOf({ name: 'playlist', id: 9 }, playlists, words)).toBeUndefined()
  })

  it('knows every kind a queue can come from, each with its own icon name', () => {
    const kinds: FromKind[] = ['playlist', 'album', 'artist', 'songs', 'radio', 'mix', 'walk', 'dj']
    expect([...FROM_KINDS].sort()).toEqual([...kinds].sort())
    expect(new Set(FROM_KINDS).size).toBe(kinds.length)
  })

  it('reads as "From <name>" to a screen reader', () => {
    expect(fromAria('From', 'Late piano')).toBe('From Late piano')
  })
})
