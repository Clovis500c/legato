import { useEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import type { VisualizerStyle } from '../../shared/theme/theme'
import { canDrawPresets, inkOf } from './VizCanvas'
import { wantsWave } from './vizLooks'
import { createPainter } from './vizPaint'
import { presetOf } from './vizPresets'
import { sampleFrame } from './vizSample'
import { gradientStops } from './vizStops'

/**
 * The previews' painters, on the page's thread: each preview is drawn once, then it rests. The Presets look has its own:
 * a painter leaving it lets its GPU picture go and waits 2 s before making another.
 */
const painters: Record<'look' | 'preset', { canvas: OffscreenCanvas; painter: ReturnType<typeof createPainter> } | undefined> = { look: undefined, preset: undefined }

/** Two seconds of the invented sound at the drawing rate: enough for the bars to rise and the waterfall to fill. */
const FRAMES = 60

/**
 * A still picture of a visualizer look (Settings' style picker), drawn by the visualizer's own painter with the user's
 * colours and options. A plugin's look has none: only its plugin can draw it.
 */
export function VizThumb({ look, className = '' }: { look: VisualizerStyle; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const settings = useSettings((s) => s.settings)
  const dark = useSettings((s) => s.current().dark)

  useEffect(() => {
    const el = ref.current
    if (!el || look === 'plugin' || !el.clientWidth || !el.clientHeight) return
    const which = look === 'preset' ? 'preset' : 'look'
    try {
      painters[which] ??= (() => {
        const canvas = new OffscreenCanvas(1, 1)
        return { canvas, painter: createPainter(canvas) }
      })()
    } catch {
      return
    }
    const { canvas, painter } = painters[which]
    const { visualizerColor: color, visualizerGradient: gradient, visualizerBands: bands } = settings
    const css = getComputedStyle(el)
    const ink = inkOf(el, color, null)
    const warn = css.getPropertyValue('--color-danger').trim() || '#d93a2b'
    const ink2 = (color !== 'accent' && css.getPropertyValue('--color-accent').trim()) || css.color
    const words = { momentary: tr('Momentary'), short: tr('Short-term'), integrated: tr('Integrated'), range: tr('Loudness range'), peak: tr('True peak') }
    const shown = look === 'preset' && !canDrawPresets() ? 'bars' : look
    const dpr = window.devicePixelRatio || 1
    painter.size(el.clientWidth, el.clientHeight, dpr)
    painter.set(shown, false, ink, warn, settings.visualizerWeighting, gradient, gradientStops(gradient, ink, warn, dark), bands, settings.visualizerFloor, ink2, words, settings.visualizerFace, settings.visualizerColormap)
    if (shown === 'particles') painter.palette([], dark)
    if (shown === 'preset') painter.preset(presetOf(settings.visualizerPreset, settings.visualizerPresets), settings.visualizerPresetColors === 'own')
    if (shown === 'loudness') painter.loud({ momentary: -11, short: -12.5, integrated: -12, range: 6, peak: -1.5, top: -0.8 })
    for (let i = 0; i < FRAMES; i++) {
      const f = sampleFrame(i / 30, bands === 'twelfth')
      painter.frame(f.l, f.r, f.rms, wantsWave(shown) ? f.w : undefined, f.peak)
      painter.draw(1 / 30)
    }
    el.width = canvas.width
    el.height = canvas.height
    el.getContext('2d')?.drawImage(canvas, 0, 0)
  }, [look, settings, dark])

  return look === 'plugin' ? <span className={className} /> : <canvas ref={ref} aria-hidden className={`block text-ink ${className}`} />
}
