import { usePlayer } from '../features/player/store'
import { useStore, type View } from './store'

/** Where the app was: screen and Now Playing open. Per device (window state), localStorage. */
interface Screen {
  view: View
  full: boolean
}

const KEY = 'screen'

// Read once at import, before anything saves: the start screen applied on settings load used to overwrite it.
const atLaunch: unknown = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
})()
const VIEWS = ['home', 'add', 'addons', 'mixes', 'mix', 'songs', 'albums', 'album', 'artists', 'artist', 'playlist', 'settings'] as const

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
  // Themes merged into Appearance (2026-10-21).
  const view = (v.name === 'settings' ? { name: 'settings', section: v.section === 'themes' ? 'appearance' : v.section } : v) as View
  return { view, full: r.full === true }
}

/** After launch (settings, library and resume done): same screen, Now Playing open if it was. */
export function restoreScreen() {
  const saved = validScreen(atLaunch, useStore.getState().playlists.map((p) => p.id))
  if (!saved) return
  useStore.getState().go(saved.view)
  useStore.setState({ back: [] })
  if (saved.full && usePlayer.getState().now) usePlayer.getState().setFull(true)
}

/** Any navigation closes Now Playing: logo, shortcuts, menus and toasts all just call go. Returns cleanup. */
export function startClosingPlayerOnNavigate(): () => void {
  return useStore.subscribe((s, p) => {
    if (s.view !== p.view && usePlayer.getState().full) usePlayer.getState().setFull(false)
  })
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
