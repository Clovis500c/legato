import type { LibraryTrack, Presence } from '../../shared/api'
import type { DiscordSettings } from '../../shared/theme/theme'
import type { NowPlaying } from '../player/store'

/** What Discord should show now. null = nothing (stopped, or paused when the add-on hides pauses). */
export function presenceFor(now: NowPlaying | undefined, track: LibraryTrack | undefined, playing: boolean, positionMs: number, durationMs: number | null, opts: DiscordSettings): Presence | null {
  if (!now || (!playing && !opts.paused)) return null
  const link: [string, string] | null = !opts.buttons
    ? null
    : now.youtubeId
      ? ['Listen on YouTube', `https://www.youtube.com/watch?v=${now.youtubeId}`]
      : now.spotifyId
        ? ['Listen on Spotify', `https://open.spotify.com/track/${now.spotifyId}`]
        : now.page?.startsWith('https://')
          ? ['Listen on Apple Music', now.page]
          : null
  // Discord fetches the cover itself: https only (local covers stay on this PC).
  const art = track?.art?.startsWith('https://') ? track.art : now.youtubeId ? `https://i.ytimg.com/vi/${now.youtubeId}/hqdefault.jpg` : null
  return {
    title: now.title,
    artist: now.artist,
    album: track?.album ?? null,
    art,
    link,
    playing,
    positionMs: Math.max(0, Math.round(positionMs)),
    durationMs: durationMs ? Math.round(durationMs) : null,
    status: opts.status,
  }
}

/** Discord draws the bar from start/end: same song and state, start moved under 3 s = nothing to send. */
export function samePresence(a: Presence | null, aAt: number, b: Presence | null, bAt: number): boolean {
  if (!a || !b) return a === b
  const { positionMs: pa, ...ra } = a
  const { positionMs: pb, ...rb } = b
  if (JSON.stringify(ra) !== JSON.stringify(rb)) return false
  return !a.playing || Math.abs(aAt - pa - (bAt - pb)) < 3000
}
