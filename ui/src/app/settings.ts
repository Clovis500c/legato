import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { api } from '../shared/api'
import { coverImage } from '../shared/art'
import { BRAND_GUARD } from '../shared/css'
import { cssVars, DEFAULTS, resolveTheme, sanitize, type Settings, type SystemAccent, type Theme } from '../shared/theme/theme'
import { effectiveFade } from '../features/player/fade'
import { usePlayer } from '../features/player/store'
import { useStore } from './store'
import { loadLang, resolveLang, useLang, type Lang } from '../shared/i18n/i18n'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
let systemAccent: SystemAccent | null = null

// Last applied settings, read back before first render: no flash of default theme while IPC loads.
const CACHE = 'settings'
// Language asked for, and its table loading: awaited before the first render, no flash of English (main.tsx).
let wanted: Lang = 'en'
let langLoad: Promise<void> = Promise.resolve()
export const languageReady = () => langLoad

/** Before first render: last session's look. Settings load (IPC) confirms it. */
export function applyCached() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) ?? 'null')
    if (!c) return
    systemAccent = c.systemAccent ?? null
    apply(sanitize(c.settings))
  } catch {
    // No cache or bad JSON: defaults until load.
  }
}

/** The theme's own CSS, then the guard keeping Music App's name, logo and legal notices as they are. */
function themeCss(css: string) {
  const style = (id: string) => {
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    return el
  }
  const own = style('theme-css')
  if (own.textContent !== css) own.textContent = css
  const guard = style('brand-guard')
  if (!guard.textContent) guard.textContent = BRAND_GUARD
  // Last in <head>: after the theme's CSS.
  if (guard.nextElementSibling) document.head.appendChild(guard)
}

function apply(s: Settings) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ settings: s, systemAccent }))
  } catch {
    // Storage off: no first-paint cache.
  }
  document.documentElement.classList.toggle('still', !s.motion)
  const lang = resolveLang(s.language, navigator.languages)
  if (wanted !== lang) {
    wanted = lang
    // Its table first (loaded on demand); a later pick wins if quicker.
    langLoad = loadLang(lang).then(
      () => {
        if (wanted !== lang) return
        useLang.setState({ lang })
        document.documentElement.lang = lang
        // Tray menu and taskbar buttons too.
        void api.setUiLanguage(lang).catch(() => {})
      },
      () => {},
    )
  }
  usePlayer.setState({ fade: effectiveFade(s), skipLong: s.skipLong, earlyEnds: s.earlyEnds })
  const root = document.documentElement.style
  const theme = resolveTheme(s, systemDark.matches, systemAccent)
  for (const [k, v] of Object.entries(cssVars(theme, s))) root.setProperty(k, v)
  root.setProperty('--theme-image', theme.background ? `url("${coverImage(theme.background.image)}")` : 'none')
  themeCss(theme.css ?? '')
  getCurrentWebview()
    .setZoom(s.zoom / 100)
    .catch(() => {})
}

interface SettingsState {
  settings: Settings
  load: () => Promise<void>
  /** Saved settings changed underneath (Sync Mode): read again, a pending save dropped (it held the old ones). */
  reload: () => Promise<void>
  update: (patch: Partial<Settings>) => void
  /** Theme currently on screen (resolved from preset, custom or system), or the one `theme` would give. */
  current: (theme?: string) => Theme
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,

  async load() {
    systemAccent = await api.systemAccent().catch(() => null)
    const s = sanitize(await api.loadSettings().catch(() => null))
    set({ settings: s })
    apply(s)
    sorts(s)
    // Start screen: replaces the default one, no history entry.
    if (useStore.getState().view.name === 'songs') useStore.setState({ view: { name: s.startView } })
  },

  async reload() {
    clearTimeout(saveTimer)
    const s = sanitize(await api.loadSettings().catch(() => null))
    set({ settings: s })
    apply(s)
    sorts(s)
  },

  // Applied at once, saved after a short pause (sliders fire many updates).
  update(patch) {
    const s = sanitize({ ...get().settings, ...patch })
    set({ settings: s })
    apply(s)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => api.saveSettings(s).catch((e) => useStore.setState({ error: String(e) })), 400)
  },

  current: (theme = get().settings.theme) => resolveTheme({ ...get().settings, theme }, systemDark.matches, systemAccent),
}))

/** Saved sorts onto the list pages. */
function sorts(s: Settings) {
  const st = useStore.getState()
  useStore.setState({ sort: s.songSort, playlistSort: s.playlistSort, albumView: { ...st.albumView, sort: s.albumSort }, artistView: { ...st.artistView, sort: s.artistSort } })
}

// A sort picked on a list page is saved (and comes back next launch).
useStore.subscribe((st, prev) => {
  if (st.sort === prev.sort && st.playlistSort === prev.playlistSort && st.albumView.sort === prev.albumView.sort && st.artistView.sort === prev.artistView.sort) return
  const s = useSettings.getState().settings
  const next = { songSort: st.sort, playlistSort: st.playlistSort, albumSort: st.albumView.sort, artistSort: st.artistView.sort }
  if (Object.entries(next).some(([k, v]) => s[k as keyof typeof next] !== v)) useSettings.getState().update(next)
})

systemDark.addEventListener('change', () => apply(useSettings.getState().settings))

// Windows accent changed in Settings: picked up when the user comes back to the app.
getCurrentWindow()
  .onFocusChanged(async ({ payload: focused }) => {
    if (!focused) return
    const next = await api.systemAccent().catch(() => null)
    if (JSON.stringify(next) === JSON.stringify(systemAccent)) return
    systemAccent = next
    const s = useSettings.getState().settings
    useSettings.setState({ settings: { ...s } })
    apply(s)
  })
  .catch(() => {})
