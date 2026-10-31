import { type ComponentType, createElement, lazy } from 'react'

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
  karaoke: () => import('../features/player/Karaoke').then((m) => ({ default: m.Karaoke })),
  vizScreen: () => import('../features/player/VizScreen').then((m) => ({ default: m.VizScreen })),
  welcome: () => import('../features/welcome/Welcome').then((m) => ({ default: m.Welcome })),
}

type Load<P> = () => Promise<{ default: ComponentType<P> }>

// React.lazy keeps a failed load for good. Each page sits behind a stable component that swaps in a new lazy when the last
// one failed: the next draw of the page (a visit, PageBoundary's Try again) asks for the chunk anew.
function page<P extends object>(fetch: Load<P>): ComponentType<P> {
  let broken = false
  const make = () =>
    lazy(() =>
      fetch().catch((e: unknown) => {
        broken = true
        throw e
      }),
    )
  let Inner = make()
  return (props: P) => {
    if (broken) {
      broken = false
      Inner = make()
    }
    return createElement(Inner as ComponentType<P>, props)
  }
}

export const HomeView = page(load.home)
export const AddView = page(load.add)
export const SearchView = page(load.search)
export const MixesView = page(load.mixes)
export const MixView = page(load.mix)
export const StatsView = page(load.stats)
export const SmartView = page(load.smart)
export const SettingsView = page(load.settings)
export const AddonsView = page(load.addons)
export const EditorPanel = page(load.editor)
export const YouTubeShelf = page(load.shelf)
export const Karaoke = page(load.karaoke)
export const VizScreen = page(load.vizScreen)
export const Welcome = page(load.welcome)

/** Starts Home's download now (before the library is in), the likeliest first screen. */
export const preloadHome = () => void load.home()

/** The other pages, one per idle slice once the app is up. A failed fetch is retried by the page itself on its visit. */
export function preloadPages() {
  const next = [load.search, load.add, load.mixes, load.stats, load.smart, load.editor, load.settings, load.addons, load.karaoke, load.vizScreen]
  const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200))
  const step = () => {
    const f = next.shift()
    if (!f) return
    void f().catch(() => {})
    idle(step)
  }
  idle(step)
}
