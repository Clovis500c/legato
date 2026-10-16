import { convertFileSrc } from '@tauri-apps/api/core'
import type { Track } from './api'

/** Remote image through the app's Rust cache (`art` scheme): the front end never hits the network. */
export const remoteArt = (url: string) => convertFileSrc(url, 'art')

/** Image candidates for a track, best first: cover embedded in its local file, then its stored art. */
export function trackArt(t: Pick<Track, 'ids' | 'art'> & { id?: number }): string[] {
  const local = t.ids.local && t.id !== undefined ? convertFileSrc(`local/${t.id}`, 'art') : null
  return [local, t.art ? remoteArt(t.art) : null].filter((s): s is string => !!s)
}

/**
 * Same artwork at the biggest size each host offers, best first (full-screen cover): YouTube Music / Google art
 * re-asked at 1200 px, Apple at 1200 px, YouTube frames as maxres (1280×720) then sd. Original last: some videos have
 * no maxres frame, Cover falls back.
 */
export function bigUrls(url: string): string[] {
  const google = /^https:\/\/[\w.-]+\.(googleusercontent|ggpht)\.com\//.test(url)
  if (google && /=w\d+-h\d+/.test(url)) return [url.replace(/=w\d+-h\d+[^/]*$/, '=w1200-h1200'), url]
  if (google && /=s\d+/.test(url)) return [url.replace(/=s\d+[^/]*$/, '=s1200'), url]
  const yt = url.match(/^https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\/(?:hq|mq|sd)?default\.(?:jpg|webp)/)
  if (yt) return [`https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${yt[1]}/sddefault.jpg`, url]
  if (/\.mzstatic\.com\//.test(url) && /\/\d+x\d+bb\.(jpg|png)$/.test(url)) return [url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/1200x1200bb.$1'), url]
  return [url]
}

/** trackArt at full-screen size: local cover first, then the biggest versions of the stored art. */
export function bigTrackArt(t: Pick<Track, 'ids' | 'art'> & { id?: number }): string[] {
  const local = t.ids.local && t.id !== undefined ? convertFileSrc(`local/${t.id}`, 'art') : null
  const remote = t.art ? bigUrls(t.art).map(remoteArt) : []
  return [local, ...remote].filter((s): s is string => !!s)
}

/** First track with art in a list (album, playlist, artist). */
export const firstArt = (tracks: Pick<Track, 'ids' | 'art'>[]) => tracks.map(trackArt).find((a) => a.length) ?? []

/** YouTube 4:3 frames (hq/sd/default.jpg) letterbox 16:9 videos: zoom past the black bars. */
export const isLetterboxed = (src: string) => /i\.ytimg\.com.*%2F(hq|sd)?default\.jpg/.test(src)
