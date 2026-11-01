import { describe, expect, it } from 'vitest'
import type { FileTags, LibraryTrack } from '../../shared/api'
import { canSave, formOf, startOf, tagsToWrite } from './tagForm'

const song = (id: number, title: string, artist: string, album: string | null = null): LibraryTrack => ({ id, added: id, addedAt: null, title, artist, album, durationMs: null, isrc: null, ids: { local: `C:/Music/${id}.mp3` } })
const tags = (patch: Partial<FileTags> = {}): FileTags => ({ title: null, artist: null, album: null, albumArtist: null, genre: null, year: null, track: null, trackTotal: null, disc: null, ...patch })

describe('Edit song info', () => {
  it('starts from what the songs share, the library where a file says nothing', () => {
    const tracks = [song(1, 'One', 'Band', 'Record'), song(2, 'Two', 'Band', 'Record')]
    const start = startOf(tracks, [tags({ genre: 'Rock', year: 1999, track: 1 }), tags({ title: 'Two!', genre: 'Rock', year: 2001, track: 2 })])
    expect(start).toEqual({ title: null, artist: 'Band', album: 'Record', albumArtist: '', genre: 'Rock', year: null, track: null, disc: '' })
    expect(formOf(start)).toMatchObject({ artist: 'Band', year: '', track: '' })
    // Files not read: the library's values.
    expect(startOf([song(3, 'Solo', 'Me')], [])).toMatchObject({ title: 'Solo', artist: 'Me', album: '', genre: '' })
  })

  it('writes only what changed; emptied fields come off, several values left empty stay', () => {
    const start = startOf([song(1, 'One', 'Band', 'Record'), song(2, 'Two', 'Band')], [tags({ genre: 'Rock', year: 1999 }), tags({ genre: 'Rock', year: 2001 })])
    const form = { ...formOf(start), album: 'Best of', genre: '', track: '7' }
    expect(tagsToWrite(form, start, { one: false, number: false })).toEqual({ title: null, artist: null, album: 'Best of', albumArtist: null, genre: '', year: null, track: 7, disc: null, number: false })
    // Numbered in order: the track field aside.
    expect(tagsToWrite({ ...form, year: '2020' }, start, { one: false, number: true })).toMatchObject({ year: 2020, track: null, number: true })
    // One song: its title and artist always, as shown; a number emptied comes off.
    const one = startOf([song(1, 'One', 'Band')], [tags({ year: 1999 })])
    expect(tagsToWrite({ ...formOf(one), year: '' }, one, { one: true, number: false })).toMatchObject({ title: 'One', artist: 'Band', album: null, year: 0 })
  })

  it('saves with a title and an artist and numbers up to 9999', () => {
    const one = startOf([song(1, 'One', 'Band')], [])
    expect(canSave(formOf(one), one, true)).toBe(true)
    expect(canSave({ ...formOf(one), title: ' ' }, one, true)).toBe(false)
    expect(canSave({ ...formOf(one), year: '19999' }, one, true)).toBe(false)
    expect(canSave({ ...formOf(one), disc: 'two' }, one, true)).toBe(false)
    const many = startOf([song(1, 'One', 'Band'), song(2, 'Two', 'Other')], [])
    expect(canSave(formOf(many), many, false)).toBe(true)
    const shared = startOf([song(1, 'One', 'Band'), song(2, 'Two', 'Band')], [])
    expect(canSave({ ...formOf(shared), artist: '' }, shared, false)).toBe(false)
  })
})
