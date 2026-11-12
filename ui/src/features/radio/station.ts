import type { LibraryTrack, RadioStation } from '../../shared/api'
import { remoteTrack } from '../player/store'

/** A station's key in a track's `ids.server` (the engine path is `server:radio:<address>`, `music_player::http::RADIO`). */
export const RADIO = 'radio:'

/** Is this track a radio station (endless: no like, no server play report, no length)? */
export const isStation = (t: { ids: { server?: string } }) => !!t.ids.server?.startsWith(RADIO)

/** A station as something the player queue plays: a recommendation-like track (not in the library), its address in `ids.server`. */
export function stationTrack(s: RadioStation): LibraryTrack {
  const meta = [s.country, [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  return remoteTrack({ title: s.name, artist: meta || 'Radio', album: null, durationMs: null, isrc: null, ids: { server: RADIO + s.url }, art: null, musicness: null, explicit: false })
}
