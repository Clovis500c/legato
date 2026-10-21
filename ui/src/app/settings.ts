import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { api } from '../shared/api'
import { cssVars, DEFAULTS, resolveTheme, sanitize, type Settings, type SystemAccent, type Theme } from '../shared/theme/theme'
import { effectiveFade } from '../features/player/fade'
import { usePlayer } from '../features/player/store'
import { useStore } from './store'
import { resolveLang, useLang } from '../shared/i18n/i18n'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
let systemAccent: SystemAccent | null = null

// Last applied settings, read back before first render: no flash of default theme while IPC loads.
const CACHE = 'settings'

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

function apply(s: Settings) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ settings: s, systemAccent }))
  } catch {
    // Storage off: no first-paint cache.
  }
  document.documentElement.classList.toggle('still', !s.motion)
  const lang = resolveLang(s.language, navigator.languages)
  if (useLang.getState().lang !== lang) {
    useLang.setState({ lang })
    document.documentElement.lang = lang
    // Tray menu and taskbar buttons too.
    void api.setUiLanguage(lang).catch(() => {})
  }
  usePlayer.setState({ fade: effectiveFade(s) })
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(cssVars(resolveTheme(s, systemDark.matches, systemAccent), s))) root.setProperty(k, v)
  getCurrentWebview()
    .setZoom(s.zoom / 100)
    .catch(() => {})
}

interface SettingsState {
  settings: Settings
  load: () => Promise<void>
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
    // Start screen: replaces the default one, no history entry.
    if (useStore.getState().view.name === 'songs') useStore.setState({ view: { name: s.startView } })
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
