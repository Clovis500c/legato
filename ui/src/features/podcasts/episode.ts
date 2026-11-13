import type { LibraryTrack, PodcastEpisode, PodcastFeed } from '../../shared/api'
import { remoteTrack } from '../player/store'

/** An episode's key in a track's `ids.server` (the engine path is `server:podcast:<audio address>`, `music_player::http::PODCAST`). */
export const PODCAST = 'podcast:'

/** An episode as something the player queue plays: a recommendation-like track (not in the library), the audio address in `ids.server`. */
export function episodeTrack(show: PodcastFeed, e: PodcastEpisode): LibraryTrack {
  return remoteTrack({ title: e.title, artist: show.title, album: null, durationMs: e.durationMs, isrc: null, ids: { server: PODCAST + e.url }, art: show.image || null, musicness: null, explicit: false })
}

/** The show as a queue (feeds list newest first, so Next goes to the older episode), started at this episode. */
export function episodeQueue(show: PodcastFeed, e: PodcastEpisode): { tracks: LibraryTrack[]; index: number } {
  const at = Math.max(0, show.episodes.findIndex((x) => x.id === e.id))
  return { tracks: show.episodes.map((x) => episodeTrack(show, x)), index: at }
}
