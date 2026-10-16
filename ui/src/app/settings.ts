import { getCurrentWebview } from '@tauri-apps/api/webview'
import { create } from 'zustand'
import { api } from '../shared/api'
import { cssVars, DEFAULTS, resolveTheme, sanitize, type Settings, type Theme } from '../shared/theme/theme'
import { useStore } from './store'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function apply(s: Settings) {
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(cssVars(resolveTheme(s, systemDark.matches), s))) root.setProperty(k, v)
  getCurrentWebview()
    .setZoom(s.zoom / 100)
    .catch(() => {})
}

interface SettingsState {
  settings: Settings
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => void
  /** Theme currently on screen (resolved from preset, custom or system). */
  current: () => Theme
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,

  async load() {
    const s = sanitize(await api.loadSettings().catch(() => null))
    set({ settings: s })
    apply(s)
  },

  // Applied at once, saved after a short pause (sliders fire many updates).
  update(patch) {
    const s = sanitize({ ...get().settings, ...patch })
    set({ settings: s })
    apply(s)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => api.saveSettings(s).catch((e) => useStore.setState({ error: String(e) })), 400)
  },

  current: () => resolveTheme(get().settings, systemDark.matches),
}))

systemDark.addEventListener('change', () => apply(useSettings.getState().settings))
