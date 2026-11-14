import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../shared/api'
import { remoteArt, sizedArt } from '../../shared/art'

// Artists' pictures found, by lowercased name (the art scheme's URL): ONE store for the big title's round picture and the
// artist's page, so both always show the same image. The picture is the artist page's own, kept by Rust (`artist_picture`).
// shortcut: one URL per artist for the session; bound it if a session ever shows thousands of artists.
export const usePictures = create<Record<string, string>>(() => ({}))

export const pictureKey = (name: string) => name.toLowerCase()

/** Asks in flight, by name and kind: the title, the page and the cards ask for the same artist within one frame, Rust is asked once. */
const pending = new Set<string>()

/** Pictures already requested for decoding (the small round size): the img finds its bytes in memory when it mounts. */
const warmed = new Set<string>()

/** Starts the picture's download and decode now, at the size a round avatar is drawn, so a card or Now Playing opened next shows it at once. */
export function warm(src: string) {
  if (warmed.has(src) || typeof Image === 'undefined') return
  warmed.add(src)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = sizedArt(src, 44, window.devicePixelRatio || 1)
}

/** Asks Rust for the picture of `name` (`ask` false: only what it already keeps, no request) and stores it. */
export function fetchPicture(name: string, ask: boolean) {
  const key = pictureKey(name)
  if (usePictures.getState()[key]) return
  const slot = `${key}
${ask}`
  if (pending.has(slot)) return
  pending.add(slot)
  void api
    .artistPicture(name, ask)
    .then(
      (url) => {
        if (!url) return
        const art = remoteArt(url)
        usePictures.setState({ [key]: art })
        warm(art)
      },
      () => {},
    )
    .finally(() => pending.delete(slot))
}

/** The artist's picture as the big title shows it; asked again when `refresh` changes (the page's own data arrived). */
export function useArtistPicture(name: string, refresh?: unknown): string | undefined {
  const url = usePictures((s) => s[pictureKey(name)])
  useEffect(() => {
    if (name) fetchPicture(name, false)
  }, [name, refresh])
  return url
}

/** The artist page's photo: that same picture when there is one, else what the page had (`rest`). */
export const photoOf = (picture: string | undefined, rest: string[]): string[] => (picture ? [picture] : rest)
