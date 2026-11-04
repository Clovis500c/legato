import { msg } from '../../shared/i18n/i18n'
import { VISUALIZER_STYLES, type VisualizerStyle, type VizBanding, type VizColor, type VizGradient, type VizWeighting } from '../../shared/theme/theme'

/** The visualizer's looks by name (Settings, the visualizer's right-click menu); show with `tr`. */
export const VISUALIZER_LABELS: Record<VisualizerStyle, string> = { led: msg('LED'), bars: msg('Bars'), mirror: msg('Mirror'), peaks: msg('Peaks'), wave: msg('Wave'), curve: msg('Curve'), radial: msg('Radial'), vu: msg('VU needles'), spectrogram: msg('Spectrogram'), scope: msg('Oscilloscope'), vectorscope: msg('Vectorscope'), loudness: msg('Loudness meter') }

/** Looks drawn from the frames' wave blocks: liveSync.ts asks for them only then. */
export const wantsWave = (look: VisualizerStyle) => look === 'scope' || look === 'vectorscope'

/** The visualizer's weightings by name (Settings); show with `tr`. */
export const VIZ_WEIGHTING_LABELS: Record<VizWeighting, string> = { flat: msg('As measured'), tilt: msg('+3 dB per octave'), a: msg('A-weighting'), itu468: msg('ITU-R 468') }

/** The visualizer's colours by name (Settings, its right-click); show with `tr`. */
export const VIZ_COLOR_LABELS: Record<VizColor, string> = { text: msg('Text color'), accent: msg('Accent color'), cover: msg("Cover's color") }

/** The visualizer's gradients by name (Settings, its right-click); show with `tr`. */
export const VIZ_GRADIENT_LABELS: Record<VizGradient, string> = { none: msg('No gradient'), level: msg('By level'), frequency: msg('Along frequency') }

/** The visualizer's bands by name (Settings, its right-click); show with `tr`. */
export const VIZ_BANDING_LABELS: Record<VizBanding, string> = { third: msg('1/3 octave (31 bands)'), sixth: msg('1/6 octave (61 bands)'), twelfth: msg('1/12 octave (121 bands)') }

/** The look after this one, round to the first (a click on the visualizer). */
export const nextLook = (look: VisualizerStyle): VisualizerStyle => VISUALIZER_STYLES[(VISUALIZER_STYLES.indexOf(look) + 1) % VISUALIZER_STYLES.length]
