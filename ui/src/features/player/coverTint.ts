import { useSettings } from '../../app/settings'
import { useAmbient } from './ambient'

/** Album, artist and playlist bands (docs/design.md): a tint of the cover on light themes, a deep tone of it on dark. */
export function useCoverTint(src: string | undefined) {
  // Re-rendered when the theme, accent or Windows' light / dark change (current() below).
  useSettings((s) => s.settings.theme)
  useSettings((s) => s.settings.accent)
  useSettings((s) => s.systemDark)
  return useAmbient(src, useSettings.getState().current())
}
