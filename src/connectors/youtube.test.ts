import { describe, expect, it } from 'vitest'
import { fakeFetch, memoryStore, validTokens } from './testing'
import { YouTubeConnector, parseDuration, parseVideo } from './youtube'

const connector = (routes: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(routes)
  return { f, yt: new YouTubeConnector('CID', 'SECRET', memoryStore({ youtube: validTokens }), () => {}, f) }
}

describe('parseVideo', () => {
  it.each([
    ['Get Lucky', 'Daft Punk - Topic', { artist: 'Daft Punk', title: 'Get Lucky' }],
    ['Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams', 'DaftPunkVEVO', { artist: 'Daft Punk', title: 'Get Lucky (Official Audio) ft. Pharrell Williams' }],
    ['Stromae – Alors on danse', 'stromae', { artist: 'Stromae', title: 'Alors on danse' }],
    ['Hello', 'AdeleVEVO', { artist: 'Adele', title: 'Hello' }],
    ['Bad Guy', 'Billie Eilish Official', { artist: 'Billie Eilish', title: 'Bad Guy' }],
  ])('%s / %s', (title, channel, out) => expect(parseVideo(title, channel)).toEqual(out))
})

it('parseDuration', () => {
  expect(parseDuration('PT4M8S')).toBe(248_000)
  expect(parseDuration('PT1H0M1S')).toBe(3_601_000)
  expect(parseDuration('PT45S')).toBe(45_000)
  expect(parseDuration('P1D')).toBeUndefined()
})

describe('YouTubeConnector', () => {
  it('liste les playlists avec pagination par pageToken', async () => {
    const { yt, f } = connector({
      'GET www.googleapis.com/youtube/v3/playlists': (url: URL) =>
        url.searchParams.get('pageToken')
          ? { items: [{ id: 'PL2', snippet: { title: 'B' } }] }
          : { items: [{ id: 'PL1', snippet: { title: 'A' } }], nextPageToken: 'n' },
    })
    expect(await yt.listPlaylists()).toEqual([
      { id: 'PL1', name: 'A' },
      { id: 'PL2', name: 'B' },
    ])
    expect(f.calls[0].url.searchParams.get('mine')).toBe('true')
  })

  it('lit une playlist, ignore les vidéos supprimées, ajoute les durées', async () => {
    const item = (videoId: string, title: string, channel?: string) => ({
      snippet: { title, videoOwnerChannelTitle: channel, resourceId: { videoId } },
    })
    const { yt, f } = connector({
      'GET www.googleapis.com/youtube/v3/playlistItems': {
        items: [item('v1', 'Get Lucky', 'Daft Punk - Topic'), item('v2', 'Deleted video'), item('v3', 'Adele - Hello', 'AdeleVEVO')],
      },
      'GET www.googleapis.com/youtube/v3/videos': {
        items: [
          { id: 'v1', contentDetails: { duration: 'PT4M8S' } },
          { id: 'v3', contentDetails: { duration: 'PT6M7S' } },
        ],
      },
    })
    expect(await yt.getPlaylistTracks('PL1')).toEqual([
      { title: 'Get Lucky', artist: 'Daft Punk', durationMs: 248_000, ids: { youtube: 'v1' } },
      { title: 'Hello', artist: 'Adele', durationMs: 367_000, ids: { youtube: 'v3' } },
    ])
    expect(f.calls[1].url.searchParams.get('id')).toBe('v1,v3')
  })

  it('writePlaylist : playlist privée puis un insert par vidéo', async () => {
    const { yt, f } = connector({
      'POST www.googleapis.com/youtube/v3/playlists': { id: 'PLNEW' },
      'POST www.googleapis.com/youtube/v3/playlistItems': () => ({}),
    })
    const id = await yt.writePlaylist('Copie', [
      { title: 'a', artist: 'b', ids: { youtube: 'v1' } },
      { title: 'c', artist: 'd', ids: { spotify: 's' } },
    ])
    expect(id).toBe('PLNEW')
    expect(JSON.parse(f.calls[0].body!).status.privacyStatus).toBe('private')
    expect(f.calls).toHaveLength(2)
    expect(JSON.parse(f.calls[1].body!).snippet).toEqual({ playlistId: 'PLNEW', resourceId: { kind: 'youtube#video', videoId: 'v1' } })
  })

  it('resolve : cherche dans la catégorie musique', async () => {
    const { yt, f } = connector({
      'GET www.googleapis.com/youtube/v3/search': { items: [{ id: { videoId: 'v9' }, snippet: { title: 'Hello', channelTitle: 'Adele - Topic' } }] },
    })
    expect((await yt.resolve({ title: 'Hello', artist: 'Adele', ids: { spotify: 's' } }))?.ids.youtube).toBe('v9')
    expect(f.calls[0].url.searchParams.get('videoCategoryId')).toBe('10')
  })
})
