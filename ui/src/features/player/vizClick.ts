import { useEffect, useRef, type MouseEvent } from 'react'
import { useSettings } from '../../app/settings'
import { nextLook } from './vizLooks'

// Long enough for a double click's second click (full screen) to come and rule the first out.
const DOUBLE_MS = 300

/** A click on the visualizer: the next look (Settings › Playback › Visualizer style), unless a double click follows. */
export function useNextLookClick() {
  const wait = useRef(0)
  useEffect(() => () => clearTimeout(wait.current), [])
  return (e: MouseEvent) => {
    clearTimeout(wait.current)
    if (e.detail > 1) return
    wait.current = window.setTimeout(() => {
      const { settings, update } = useSettings.getState()
      update({ visualizerStyle: nextLook(settings.visualizerStyle) })
    }, DOUBLE_MS)
  }
}
