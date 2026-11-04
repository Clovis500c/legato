import { describe, expect, it } from 'vitest'
import { silentViz, VIZ_FINE, type VizFrame } from '../player/vizUnpack'
import { weightsOf } from '../player/vizWeigh'
import { OVERLAY_BARS, overlayBars } from './overlayBars'

/** A frame with one band at `db` on both sides, the rest silent. */
function tone(band: number, db: number, n?: number): VizFrame {
  const f = silentViz(n)
  f.left[band] = db
  f.right[band] = db
  return f
}

describe('overlay bars', () => {
  it('reads silence as empty bars', () => {
    const bars = overlayBars(silentViz(), weightsOf('flat'))
    expect(bars).toHaveLength(OVERLAY_BARS)
    expect(bars.every((b) => b === 0)).toBe(true)
  })

  it('puts 1 kHz in its third, full at the top of the scale', () => {
    // Sixth 34 = 1 kHz = third 17; twelfth 68 the same.
    for (const f of [tone(34, -10), tone(68, -10, VIZ_FINE)]) {
      const bars = overlayBars(f, weightsOf('flat', f.left.length))
      expect(bars[17]).toBe(255)
      expect(bars.filter((b) => b > 0)).toHaveLength(1)
    }
  })

  it('weighs the bands first', () => {
    // 8 kHz is 3 octaves over 1 kHz: the tilt lifts it 9 dB, -40 reads as -31.
    const flat = overlayBars(tone(52, -40), weightsOf('flat'))[26]
    const tilted = overlayBars(tone(52, -40), weightsOf('tilt'))[26]
    expect(flat).toBe(Math.round(((-40 + 78) / 68) * 255))
    expect(tilted).toBe(Math.round(((-31 + 78) / 68) * 255))
  })
})
