import { expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { closeBlind, openBlind, useBlind } from './blindOpen'

it('a game can be opened on one list of songs (a playlist); the plain one takes the library, and closing forgets the list', () => {
  const pool = [{ id: 1 }] as LibraryTrack[]
  openBlind(pool)
  expect(useBlind.getState()).toMatchObject({ open: true, pool })
  closeBlind()
  expect(useBlind.getState()).toMatchObject({ open: false, pool: undefined })
  openBlind()
  expect(useBlind.getState()).toMatchObject({ open: true, pool: undefined })
  closeBlind()
})
