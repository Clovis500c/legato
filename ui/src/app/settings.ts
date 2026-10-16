import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { api } from '../shared/api'
import { cssVars, DEFAULTS, resolveTheme, sanitize, type Settings, type SystemAccent, type Theme } from '../shared/theme/theme'
import { useStore } from './store'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
let systemAccent: SystemAccent | null = null

function apply(s: Settings) {
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
  /** Theme currently on screen (resolved from preset, custom or system). */
  current: () => Theme
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,

  async load() {
    systemAccent = await api.systemAccent().catch(() => null)
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

  current: () => resolveTheme(get().settings, systemDark.matches, systemAccent),
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
