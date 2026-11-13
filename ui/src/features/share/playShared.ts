import { useStore } from '../../app/store'
import { api, type LibraryTrack, type SharedSong } from '../../shared/api'
import { region } from '../../shared/format'
import { remoteTrack, usePlayer } from '../player/store'

/** What `playSharedSong` leans on, replaceable in tests. */
export interface PlayDeps {
  song: (code: string) => Promise<SharedSong>
  library: () => LibraryTrack[]
  play: (list: LibraryTrack[]) => void
  fail: (e: unknown) => void
}

const live: PlayDeps = {
  song: (code) => api.shareSong(code, region()),
  library: () => useStore.getState().tracks,
  play: (list) => usePlayer.getState().playTracks(list, 0),
  fail: (e) => useStore.getState().notify(String(e), { kind: 'error' }),
}

/**
 * A shared code that holds ONE song (a link, the picture of "Share as a picture"): it plays, instead of the import box for a
 * playlist. The library's own row when it has the song, else the song with the sources it came with (YouTube, Apple), found on
 * YouTube when the sender gave only a title. It is played, not added: Add to library stays the user's call. True = played.
 */
export async function playSharedSong(code: string, d: PlayDeps = live): Promise<boolean> {
  try {
    const { track, libraryId } = await d.song(code)
    d.play([d.library().find((t) => t.id === libraryId) ?? remoteTrack(track)])
    return true
  } catch (e) {
    d.fail(e)
    return false
  }
}
