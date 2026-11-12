import { expect, it } from 'vitest'
import { nameOfFile, ownFile } from './dropKinds'

it("picks Legato's own file in a drop by its type, a remix before a backup before a theme before a list", () => {
  expect(ownFile(['C:\\a\\song.mp3', 'C:\\a\\mix.LMIX'])).toEqual({ kind: 'remix', path: 'C:\\a\\mix.LMIX' })
  expect(ownFile(['C:\\a\\list.m3u', 'C:\\a\\x.legato'])?.kind).toBe('backup')
  expect(ownFile(['C:\\a\\list.m3u', 'C:\\a\\night.theme'])?.kind).toBe('theme')
  expect(ownFile(['C:\\a\\list.XSPF'])?.kind).toBe('songlist')
})

it('leaves music, folders and pictures to the usual drop', () => {
  expect(ownFile(['C:\\Music\\a.flac', 'C:\\Music\\Album', 'C:\\x.png'])).toBeNull()
  expect(ownFile(['C:\\a\\mix.lmix.exe', 'C:\\a\\backup.legato.zip'])).toBeNull()
  expect(ownFile([])).toBeNull()
})

it('names a list from its file', () => {
  expect(nameOfFile('C:\\Lists\\Road trip.m3u8')).toBe('Road trip')
  expect(nameOfFile('/home/me/mix.v2.csv')).toBe('mix.v2')
  expect(nameOfFile('C:\\.txt')).toBe('Playlist')
})
