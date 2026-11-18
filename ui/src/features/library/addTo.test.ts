import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist } from '../../shared/api'
import { copyNamed, takesCopy } from './addTo'

const list = (id: number, source: LibraryPlaylist['source'], custom: boolean, name = `List ${id}`, sourceId = `s${id}`): LibraryPlaylist => ({ id, source, sourceId, name, trackCount: 3, custom, newestFirst: false, orderManual: false })

describe('Add to playlist › an imported playlist', () => {
  const spotify = list(1, 'spotify', false, 'Road trip')
  const youtube = list(2, 'youtube', false)
  const likes = list(3, 'youtube', false, 'Liked Music', 'LM')
  const mine = list(4, 'local', true, 'Road trip (copy)')

  it('goes through your own copy when the app cannot write to it, never for your own lists or YouTube likes', () => {
    const signedOut = () => false
    expect(takesCopy(spotify, signedOut)).toBe(true)
    expect(takesCopy(youtube, signedOut)).toBe(true)
    expect(takesCopy(youtube, (p) => p.source === 'youtube')).toBe(false)
    expect(takesCopy(likes, signedOut)).toBe(false)
    expect(takesCopy(mine, signedOut)).toBe(false)
  })

  it('the copy made at the first add is found again by its name, and only among your own lists', () => {
    expect(copyNamed('Road trip (copy)', [spotify, mine])).toBe(mine)
    expect(copyNamed('Road trip', [spotify])).toBeUndefined()
  })
})
