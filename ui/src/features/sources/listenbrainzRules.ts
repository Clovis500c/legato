import type { LibraryTrack, Listen } from '../../shared/api'
import type { NowPlaying } from '../player/store'

/** ListenBrainz's rule: half of the song or 4 minutes heard, whichever comes first. Length unknown: 4 minutes. */
export const counts = (durationMs: number | null, listenedMs: number) => listenedMs >= Math.min(durationMs ? durationMs / 2 : Infinity, 240_000)

/** Where a song played from, noted as it started: its YouTube video or Spotify track (a file of yours: neither). */
export type PlayedFrom = Pick<NowPlaying, 'via' | 'youtubeId' | 'spotifyId'>

/** A listen to send. Not noted (it started before the app did): the source the player tries first. */
export function toListen(t: Pick<LibraryTrack, 'artist' | 'title' | 'album' | 'durationMs' | 'isrc' | 'ids'>, listenedAt: number, from?: PlayedFrom, durationMs: number | null = t.durationMs): Listen {
  const via = from?.via ?? (t.ids.local ? 'local' : t.ids.youtube ? 'youtube' : undefined)
  return {
    artist: t.artist,
    track: t.title,
    album: t.album,
    durationMs: durationMs ? Math.round(durationMs) : null,
    listenedAt,
    isrc: t.isrc,
    youtubeId: via === 'youtube' ? (from?.youtubeId ?? t.ids.youtube ?? null) : null,
    spotifyId: via === 'spotify' ? (from?.spotifyId ?? t.ids.spotify ?? null) : null,
  }
}
