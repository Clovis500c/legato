import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MENU_ITEMS } from '../shared/ui/menuShape'

const read = (files: string[]) => files.map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).join('\n')
/** Where menus are built, and where pages add their own items to `tracksMenu`. */
const builders = read(['menus.tsx', 'player/UpNext.tsx'])
const source = read(['menus.tsx', 'player/UpNext.tsx', 'library/AlbumArtist.tsx', 'library/LibraryView.tsx', 'library/TrackTable.tsx', 'home/HomeView.tsx'])
const known = new Set(Object.values(MENU_ITEMS).flatMap((defs) => defs.map((d) => d.id)))

it('every id a builder gives is in the table, so no item escapes the layout by a typo', () => {
  const used = [...builders.matchAll(/(?:\bid: |\btag\()'([A-Za-z]+)'/g)].map((m) => m[1])
  expect(used.length).toBeGreaterThan(100)
  // 'more' is the folding submenu's own.
  expect(used.filter((i) => !known.has(i) && i !== 'more')).toEqual([])
})

it('every item the table lists is given by some builder', () => {
  const missing = [...known].filter((id) => !source.includes(`id: '${id}'`) && !source.includes(`tag('${id}'`))
  expect(missing).toEqual([])
})

it('Standard loses nothing in the menus wired last: the visualizer’s and a catalog result’s items are never detail', () => {
  const detail = (kind: 'visualizer' | 'track', ids: string[]) => MENU_ITEMS[kind].filter((d) => ids.includes(d.id) && d.level === 'detail').map((d) => d.id)
  expect(MENU_ITEMS.visualizer.length).toBe(11)
  expect(detail('visualizer', MENU_ITEMS.visualizer.map((d) => d.id))).toEqual([])
  expect(detail('track', ['addToLibrary', 'play', 'playNext', 'addToQueue', 'addTo', 'copyLink', 'copyTitle', 'openIn'])).toEqual([])
})

it('the customising screen lists every kind that has items to choose (album and artist reuse the songs’ menu)', () => {
  const screen = readFileSync(new URL('./settings/MenuCustomize.tsx', import.meta.url), 'utf8')
  const listed = [...screen.matchAll(/\['([a-z]+)', msg\(/g)].map((m) => m[1])
  const withItems = Object.entries(MENU_ITEMS).filter(([, defs]) => defs.length).map(([k]) => k)
  expect(listed.sort()).toEqual(withItems.sort())
})
