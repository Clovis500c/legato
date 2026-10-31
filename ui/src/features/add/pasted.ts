/** Spotify's desktop app copies a list's songs as track links (Ctrl+A, Ctrl+C): those go to their own import (src-tauri spotify_paste.rs). */
export const hasSpotifyTracks = (text: string) => /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/[A-Za-z0-9]{22}|spotify:track:[A-Za-z0-9]{22}/.test(text)
