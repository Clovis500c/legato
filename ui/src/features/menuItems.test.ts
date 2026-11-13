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
