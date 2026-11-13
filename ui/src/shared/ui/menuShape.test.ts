import { describe, expect, it } from 'vitest'
import { DEFAULT_MENU_LAYOUT, MAX_INLINE, MENU_ITEMS, foldedBy, moveItem, orderedDefs, readLayout, resetKind, shapeMenu, toggleItem, type MenuLayout } from './menuShape'

interface Item {
  id?: string
  label: string
  items?: (Item | '-')[]
}
const more = (items: (Item | '-')[]): Item => ({ label: 'More…', items })
const item = (id?: string): Item => ({ id, label: id ?? 'plain' })
const labels = (list: (Item | '-')[]): string[] => list.map((e) => (e === '-' ? '-' : e.items ? `More[${e.items.map((x) => (x === '-' ? '-' : x.label)).join(',')}]` : e.label))
const layout = (l: Partial<MenuLayout>): MenuLayout => ({ ...DEFAULT_MENU_LAYOUT, ...l })

describe('menu shapes', () => {
  const track = [item('play'), item('playNext'), '-' as const, item('addTo'), false as const, item('saveCover'), item('credits'), '-' as const, item('copyLink')]

  it('Standard, the default, keeps every item: the detailed ones under More…', () => {
    expect(DEFAULT_MENU_LAYOUT.preset).toBe('standard')
    expect(labels(shapeMenu('track', track, DEFAULT_MENU_LAYOUT, more))).toEqual(['play', 'playNext', '-', 'addTo', '-', 'copyLink', '-', 'More[saveCover,credits]'])
  })

  it('Full detail is the menu as built; Essentials keeps the essential ones and folds the rest', () => {
    expect(labels(shapeMenu('track', track, layout({ preset: 'full' }), more))).toEqual(['play', 'playNext', '-', 'addTo', 'saveCover', 'credits', '-', 'copyLink'])
    expect(labels(shapeMenu('track', track, layout({ preset: 'essentials' }), more))).toEqual(['play', '-', 'addTo', '-', 'More[playNext,saveCover,credits,copyLink]'])
  })

  it('hides what the user took out and follows their order', () => {
    const l = layout({ preset: 'full', hidden: { track: ['credits', 'gone-long-ago'] }, order: { track: ['copyLink', 'addTo'] } })
    expect(labels(shapeMenu('track', track, l, more))).toEqual(['copyLink', 'addTo', 'play', 'playNext', 'saveCover'])
  })

  it('an item with no id, or an id nobody knows, stays where it is', () => {
    expect(labels(shapeMenu('track', [item('play'), item(), item('plugin:x')], DEFAULT_MENU_LAYOUT, more))).toEqual(['play', 'plain', 'plugin:x'])
    expect(labels(shapeMenu('playlist', [item('whatever')], layout({ preset: 'essentials' }), more))).toEqual(['More[whatever]'])
  })

  it('a long menu stays short: past MAX_INLINE items, the rest is under More…', () => {
    const long = Array.from({ length: MAX_INLINE + 4 }, (_, i) => item(`x${i}`))
    const out = shapeMenu('track', long, DEFAULT_MENU_LAYOUT, more)
    expect(out.filter((e) => e !== '-' && !e.items)).toHaveLength(MAX_INLINE)
    expect(labels(out).at(-1)).toBe('More[x16,x17,x18,x19]')
  })

  it('every surface keeps a menu: hiding everything gives the menu back as built', () => {
    expect(labels(shapeMenu('track', [item('play')], layout({ hidden: { track: ['play'] } }), more))).toEqual(['play'])
    expect(shapeMenu('track', [], DEFAULT_MENU_LAYOUT, more)).toEqual([])
  })

  it('ids are unique within a kind', () => {
    for (const defs of Object.values(MENU_ITEMS)) expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length)
  })

  it('a saved layout is read back safely', () => {
    expect(readLayout(undefined)).toEqual(DEFAULT_MENU_LAYOUT)
    expect(readLayout({ preset: 'loud', hidden: { track: ['play', 3, ''], nope: ['x'] }, order: 'x' })).toEqual({ preset: 'standard', hidden: { track: ['play'] }, order: {} })
    expect(readLayout({ preset: 'full', hidden: {}, order: { player: ['a'] } }).preset).toBe('full')
  })
})

describe('the customising screen', () => {
  const ids = (l: MenuLayout) => orderedDefs('folder', l).map((d) => d.id)
  it('lists the items in the user\'s order, a move swaps neighbours and stops at the ends', () => {
    expect(ids(DEFAULT_MENU_LAYOUT)).toEqual(['play', 'shuffle', 'startRadio', 'autoDj', 'rename', 'delete'])
    const moved = moveItem(DEFAULT_MENU_LAYOUT, 'folder', 'rename', -1)
    expect(ids(moved)).toEqual(['play', 'shuffle', 'startRadio', 'rename', 'autoDj', 'delete'])
    expect(moveItem(moved, 'folder', 'play', -1)).toBe(moved)
    expect(ids(moveItem(DEFAULT_MENU_LAYOUT, 'folder', 'delete', 1))).toEqual(ids(DEFAULT_MENU_LAYOUT))
  })

  it('hides and shows an item, and a reset clears one kind only', () => {
    const hidden = toggleItem(toggleItem(DEFAULT_MENU_LAYOUT, 'folder', 'delete'), 'playlist', 'open')
    expect(hidden.hidden).toEqual({ folder: ['delete'], playlist: ['open'] })
    expect(toggleItem(hidden, 'folder', 'delete').hidden).toEqual({ playlist: ['open'] })
    const both = moveItem(hidden, 'folder', 'rename', -1)
    expect(resetKind(both, 'folder')).toEqual({ ...both, hidden: { playlist: ['open'] }, order: {} })
  })

  it('says which items a preset folds', () => {
    const rename = MENU_ITEMS.folder.find((d) => d.id === 'rename')!
    expect([foldedBy('essentials', rename), foldedBy('standard', rename)]).toEqual([true, false])
  })
})
