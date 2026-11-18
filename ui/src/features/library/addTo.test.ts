import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist } from '../../shared/api'
import { addsHere } from './addTo'

const list = (id: number, source: LibraryPlaylist['source'], custom: boolean, name = `List ${id}`, sourceId = `s${id}`): LibraryPlaylist => ({ id, source, sourceId, name, trackCount: 3, custom, newestFirst: false, orderManual: false })

describe('Add to playlist › an imported playlist', () => {
  const spotify = list(1, 'spotify', false, 'Road trip')
  const youtube = list(2, 'youtube', false)
  const likes = list(3, 'youtube', false, 'Liked Music', 'LM')
  const mine = list(4, 'local', true)

  it('takes the song here when the app cannot write to it at its source, never for your own lists or YouTube likes', () => {
    const signedOut = () => false
    expect(addsHere(spotify, signedOut)).toBe(true)
    expect(addsHere(youtube, signedOut)).toBe(true)
    expect(addsHere(youtube, (p) => p.source === 'youtube')).toBe(false)
    expect(addsHere(likes, signedOut)).toBe(false)
    expect(addsHere(mine, signedOut)).toBe(false)
  })
})
