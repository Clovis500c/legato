import { lazy } from 'react'

// Pages that load on their first visit, not at launch (the shell, sidebar and player stay in the first chunk).
// `preloadPages` pulls them in when idle, so a click rarely waits. Home is asked for at once: it is the usual first screen.
const load = {
  home: () => import('../features/home/HomeView').then((m) => ({ default: m.HomeView })),
  add: () => import('../features/add/AddView').then((m) => ({ default: m.AddView })),
  search: () => import('../features/search/SearchView').then((m) => ({ default: m.SearchView })),
  mixes: () => import('../features/mixes/MixesView').then((m) => ({ default: m.MixesView })),
  mix: () => import('../features/mixes/MixesView').then((m) => ({ default: m.MixView })),
  stats: () => import('../features/stats/StatsView').then((m) => ({ default: m.StatsView })),
  smart: () => import('../features/smart/SmartView').then((m) => ({ default: m.SmartView })),
  settings: () => import('../features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
  addons: () => import('../features/addons/AddonsView').then((m) => ({ default: m.AddonsView })),
  editor: () => import('../features/editor/EditorPanel').then((m) => ({ default: m.EditorPanel })),
  shelf: () => import('../features/home/HomeView').then((m) => ({ default: m.YouTubeShelf })),
  welcome: () => import('../features/welcome/Welcome').then((m) => ({ default: m.Welcome })),
}

export const HomeView = lazy(load.home)
export const AddView = lazy(load.add)
export const SearchView = lazy(load.search)
export const MixesView = lazy(load.mixes)
export const MixView = lazy(load.mix)
export const StatsView = lazy(load.stats)
export const SmartView = lazy(load.smart)
export const SettingsView = lazy(load.settings)
export const AddonsView = lazy(load.addons)
export const EditorPanel = lazy(load.editor)
export const YouTubeShelf = lazy(load.shelf)
export const Welcome = lazy(load.welcome)

/** Starts Home's download now (before the library is in), the likeliest first screen. */
export const preloadHome = () => void load.home()

/** The other pages, one per idle slice once the app is up. A failed fetch is retried by the page itself on its visit. */
export function preloadPages() {
  const next = [load.search, load.add, load.mixes, load.stats, load.smart, load.editor, load.settings, load.addons]
  const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200))
  const step = () => {
    const f = next.shift()
    if (!f) return
    void f().catch(() => {})
    idle(step)
  }
  idle(step)
}
