import { expect, it, vi } from 'vitest'
import { api } from '../../shared/api'
import { fetchPicture, photoOf, pictureKey, usePictures } from './artistPicture'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string, s: string) => `http://${s}.localhost/${encodeURIComponent(p)}`, invoke: vi.fn() }))
vi.stubGlobal('window', { devicePixelRatio: 1 })

it("the artist's page photo is the big title's round picture, found under the same key", () => {
  usePictures.setState({ [pictureKey('Ta2Cute')]: 'art://ta2cute.jpg' })
  // The big title reads the store by the lowercased name of each credited artist; the page by the artist it shows.
  expect(usePictures.getState()[pictureKey('ta2cute')]).toBe('art://ta2cute.jpg')
  expect(photoOf(usePictures.getState()[pictureKey('TA2CUTE')], ['art://first-song-cover.jpg'])).toEqual(['art://ta2cute.jpg'])
})

it('falls back to what the page had when no picture is kept', () => {
  expect(photoOf(undefined, ['art://cover.jpg'])).toEqual(['art://cover.jpg'])
  expect(photoOf(undefined, [])).toEqual([])
})

it('asks Rust once for an artist however many places ask in the same moment, then keeps the picture', async () => {
  usePictures.setState({}, true)
  const ask = vi.spyOn(api, 'artistPicture').mockResolvedValue('https://yt3.ggpht.com/p=s88')
  fetchPicture('Same Artist', false)
  fetchPicture('same artist', false)
  fetchPicture('Same Artist', true)
  await new Promise((r) => setTimeout(r))
  // One call for each kind (kept only, may ask) in flight: never a third for a name already being asked.
  expect(ask).toHaveBeenCalledTimes(2)
  fetchPicture('Same Artist', true)
  expect(ask).toHaveBeenCalledTimes(2)
  expect(Object.keys(usePictures.getState())).toEqual(['same artist'])
})
