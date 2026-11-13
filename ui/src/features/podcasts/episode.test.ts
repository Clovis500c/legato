import { describe, expect, it } from 'vitest'
import type { PodcastFeed } from '../../shared/api'
import { episodeQueue, episodeTrack } from './episode'

const show: PodcastFeed = {
  url: 'https://feed.example/rss',
  title: 'Night',
  author: '',
  image: '',
  episodes: [
    { id: 'b', title: 'Two', url: 'https://cdn.example/2.mp3', durationMs: 60_000, published: '' },
    { id: 'a', title: 'One', url: 'https://cdn.example/1.mp3', durationMs: null, published: '' },
  ],
}

describe('podcast episodes', () => {
  it('an episode plays by its audio address, under the show name', () => {
    const t = episodeTrack(show, show.episodes[0])
    expect([t.title, t.artist, t.durationMs, t.ids.server]).toEqual(['Two', 'Night', 60_000, 'podcast:https://cdn.example/2.mp3'])
  })
  it('the queue is the show, started at the chosen episode', () => {
    const q = episodeQueue(show, show.episodes[1])
    expect([q.tracks.length, q.index]).toEqual([2, 1])
    expect(episodeQueue(show, { ...show.episodes[0], id: 'zz' }).index).toBe(0)
  })
})
