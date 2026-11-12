import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../shared/api'
import { remoteArt } from '../../shared/art'

// Artists' pictures found, by lowercased name (the art scheme's URL): ONE store for the big title's round picture and the
// artist's page, so both always show the same image. The picture is the artist page's own, kept by Rust (`artist_picture`).
// shortcut: one URL per artist for the session; bound it if a session ever shows thousands of artists.
export const usePictures = create<Record<string, string>>(() => ({}))

export const pictureKey = (name: string) => name.toLowerCase()

/** Asks Rust for the picture of `name` (`ask` false: only what it already keeps, no request) and stores it. */
export function fetchPicture(name: string, ask: boolean) {
  const key = pictureKey(name)
  if (usePictures.getState()[key]) return
  void api.artistPicture(name, ask).then(
    (url) => url && usePictures.setState({ [key]: remoteArt(url) }),
    () => {},
  )
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
