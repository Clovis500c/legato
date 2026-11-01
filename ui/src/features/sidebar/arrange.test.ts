import { describe, expect, it } from 'vitest'
import type { PlaylistFolder } from '../../shared/theme/theme'
import { addFolder, arrange, moveToFolder, togglePin } from './arrange'

const folder = (id: string, keys: string[], open = true): PlaylistFolder => ({ id, name: id, keys, open })
// Rows as short strings: "*a" pinned, "[F 2]" a folder and its count, "  a" inside a folder.
const show = (shown: string[], pinned: string[], folders: PlaylistFolder[]) =>
  arrange(shown, (p) => p, pinned, folders).map((r) => (r.kind === 'folder' ? `[${r.folder.id} ${r.count}]` : `${r.pinned ? '*' : r.depth ? '  ' : ''}${r.p}`))

describe('Your library’s playlists', () => {
  it('pinned first as pinned, then folders with their playlists, then the others in the order picked', () => {
    expect(show(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], [folder('F', ['e', 'a'])])).toEqual(['*d', '*b', '[F 2]', '  a', '  e', 'c'])
  })

  it('a closed folder hides its playlists; a pinned one shows once, on top; gone playlists leave no row', () => {
    expect(show(['a', 'b', 'c'], ['a', 'gone'], [folder('F', ['a', 'b', 'gone'], false), folder('G', [])])).toEqual(['*a', '[F 1]', '[G 0]', 'c'])
  })
})

describe('pins and folders', () => {
  it('pins under the others, unpins', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('moves a playlist out of its folder into another (opened), or out of all', () => {
    const two = [folder('F', ['a', 'b'], false), folder('G', ['c'], false)]
    expect(moveToFolder(two, 'a', 'G')).toEqual([folder('F', ['b'], false), folder('G', ['c', 'a'])])
    expect(moveToFolder(two, 'c', null)).toEqual([folder('F', ['a', 'b'], false), folder('G', [], false)])
  })

  it('makes a folder at the end, holding the playlist it was made for', () => {
    expect(addFolder([folder('F', ['a'])], 'New', 'a', 'N')).toEqual([folder('F', []), { id: 'N', name: 'New', keys: ['a'], open: true }])
    expect(addFolder([], 'New', undefined, 'N')).toEqual([{ id: 'N', name: 'New', keys: [], open: true }])
  })
})
