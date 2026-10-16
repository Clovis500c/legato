import { describe, expect, it } from 'vitest'
import { contrastReport, PRESETS } from '../../shared/theme/theme'
import { tintPalette, type Rgb } from './ambient'

describe('tintPalette', () => {
  it('keeps every theme text readable on any cover tint', () => {
    const covers: Rgb[] = [[255, 0, 0], [20, 200, 40], [30, 60, 255], [250, 220, 10], [128, 128, 128], [0, 0, 0], [255, 255, 255], [200, 30, 160]]
    for (const theme of PRESETS)
      for (const rgb of covers) {
        const t = { ...theme, ...tintPalette(rgb, theme) }
        expect(contrastReport(t).filter((c) => !c.ok && c.label !== 'Icon on accent'), `${theme.id} ${rgb}`).toEqual([])
      }
  })

  it('stays flat and in the hue of the cover', () => {
    const [graphite, paper] = ['graphite', 'paper'].map((id) => PRESETS.find((t) => t.id === id)!)
    expect(tintPalette([255, 0, 0], graphite).bg).toBe('#290F0F')
    expect(tintPalette([128, 128, 128], paper).bg).toBe('#F0F0F0')
  })
})
