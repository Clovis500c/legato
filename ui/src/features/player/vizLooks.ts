import { msg } from '../../shared/i18n/i18n'
import type { VisualizerStyle } from '../../shared/theme/theme'

/** The visualizer's looks by name (Settings, the visualizer's right-click menu); show with `tr`. */
export const VISUALIZER_LABELS: Record<VisualizerStyle, string> = { led: msg('LED'), bars: msg('Bars'), mirror: msg('Mirror'), peaks: msg('Peaks'), wave: msg('Wave'), radial: msg('Radial'), vu: msg('VU needles'), spectrogram: msg('Spectrogram') }
