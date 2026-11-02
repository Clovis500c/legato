import { msg } from '../../shared/i18n/i18n'
import type { VisualizerStyle, VizColor, VizWeighting } from '../../shared/theme/theme'

/** The visualizer's looks by name (Settings, the visualizer's right-click menu); show with `tr`. */
export const VISUALIZER_LABELS: Record<VisualizerStyle, string> = { led: msg('LED'), bars: msg('Bars'), mirror: msg('Mirror'), peaks: msg('Peaks'), wave: msg('Wave'), radial: msg('Radial'), vu: msg('VU needles'), spectrogram: msg('Spectrogram') }

/** The visualizer's weightings by name (Settings); show with `tr`. */
export const VIZ_WEIGHTING_LABELS: Record<VizWeighting, string> = { flat: msg('As measured'), tilt: msg('+3 dB per octave'), a: msg('A-weighting'), itu468: msg('ITU-R 468') }

/** The visualizer's colours by name (Settings, its right-click); show with `tr`. */
export const VIZ_COLOR_LABELS: Record<VizColor, string> = { text: msg('Text color'), accent: msg('Accent color'), cover: msg("Cover's color") }
