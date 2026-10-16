import { usePlayer } from '../features/player/store'
import { useStore, type View } from './store'

/** Where the app was: screen and Now Playing open. Per device (window state), localStorage. */
interface Screen {
  view: View
  full: boolean
}

const KEY = 'screen'
const VIEWS = ['add', 'addons', 'mixes', 'mix', 'songs', 'albums', 'album', 'artists', 'artist', 'playlist', 'settings'] as const

/** Stored screen → view still valid today (playlist deleted since: no). */
export function validScreen(raw: unknown, playlistIds: number[]): Screen | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { view?: Record<string, unknown>; full?: unknown }
  const v = r.view
  if (!v || !VIEWS.includes(v.name as (typeof VIEWS)[number])) return null
  if (v.name === 'playlist' && !playlistIds.includes(v.id as number)) return null
  if (v.name === 'mix' && typeof v.id !== 'string') return null
  if ((v.name === 'album' || v.name === 'artist') && typeof v.artist !== 'string') return null
  if (v.name === 'settings' && typeof v.section !== 'string') return null
  // Search highlight and Spotify wizard: not worth reopening.
  const view = (v.name === 'settings' ? { name: 'settings', section: v.section } : v) as View
  return { view, full: r.full === true }
}

/** After launch (settings, library and resume done): same screen, Now Playing open if it was. */
export function restoreScreen() {
  let saved: Screen | null = null
  try {
    saved = validScreen(JSON.parse(localStorage.getItem(KEY) ?? 'null'), useStore.getState().playlists.map((p) => p.id))
  } catch {
    return
  }
  if (!saved) return
  useStore.getState().go(saved.view)
  useStore.setState({ back: [] })
  if (saved.full && usePlayer.getState().now) usePlayer.getState().setFull(true)
}

/** Keeps the stored screen current. Returns cleanup. */
export function startScreenSaving(): () => void {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ view: useStore.getState().view, full: usePlayer.getState().full }))
    } catch {
      // Storage off: opens on the start screen.
    }
  }
  const a = useStore.subscribe((s, p) => s.view !== p.view && save())
  const b = usePlayer.subscribe((s, p) => s.full !== p.full && save())
  return () => {
    a()
    b()
  }
}
