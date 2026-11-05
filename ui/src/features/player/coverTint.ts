import { useEffect } from 'react'
import { setCoverAccent, useSettings } from '../../app/settings'
import { averageColor, useAmbient, vivid } from './ambient'

/** Album, artist and playlist bands (docs/design.md): a tint of the cover on light themes, a deep tone of it on dark. */
export function useCoverTint(src: string | undefined) {
  // Re-rendered when the theme, accent or Windows' light / dark change (current() below).
  useSettings((s) => s.settings.theme)
  useSettings((s) => s.settings.accent)
  useSettings((s) => s.systemDark)
  return useAmbient(src, useSettings.getState().current())
}

/**
 * Accent 'cover' (Settings › Appearance › Accent color): the playing cover's hue, vivid, 3:1 on the background (ambient.ts
 * `vivid`); the theme's own accent while nothing plays or the cover is grey.
 */
export function useCoverAccent(src: string | undefined) {
  useSettings((s) => s.settings.theme)
  useSettings((s) => s.systemDark)
  const dark = useSettings.getState().current().dark
  useEffect(() => {
    // A song to the next: the last one's kept until this one's is read, no flash of the theme's.
    if (!src) {
      setCoverAccent(null)
      return
    }
    let live = true
    void averageColor(src).then((rgb) => live && setCoverAccent(rgb && vivid(rgb, dark)))
    return () => {
      live = false
    }
  }, [src, dark])
}
