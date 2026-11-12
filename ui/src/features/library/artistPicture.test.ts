import { expect, it } from 'vitest'
import { photoOf, pictureKey, usePictures } from './artistPicture'

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
