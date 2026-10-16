import { convertFileSrc } from '@tauri-apps/api/core'
import type { Track } from './api'

/** Remote image through the app's Rust cache (`art` scheme): the front end never hits the network. */
export const remoteArt = (url: string) => convertFileSrc(url, 'art')

/** Image candidates for a track, best first: cover embedded in its local file, then its stored art. */
export function trackArt(t: Pick<Track, 'ids' | 'art'> & { id?: number }): string[] {
  const local = t.ids.local && t.id !== undefined ? convertFileSrc(`local/${t.id}`, 'art') : null
  return [local, t.art ? remoteArt(t.art) : null].filter((s): s is string => !!s)
}

/** First track with art in a list (album, playlist, artist). */
export const firstArt = (tracks: Pick<Track, 'ids' | 'art'>[]) => tracks.map(trackArt).find((a) => a.length) ?? []

/** YouTube 4:3 frames (hq/sd/default.jpg) letterbox 16:9 videos: zoom past the black bars. */
export const isLetterboxed = (src: string) => /i\.ytimg\.com.*%2F(hq|sd)?default\.jpg/.test(src)
