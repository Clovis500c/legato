import { describe, expect, it } from 'vitest'
import { contrast, contrastReport, PRESETS } from '../../shared/theme/theme'
import { tintPalette, vivid, type Rgb } from './ambient'

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
    expect(tintPalette([128, 128, 128], paper).bg).toBe('#F7F7F7')
  })
})

describe('vivid cover color', () => {
  it('keeps the hue, readable on the theme', () => {
    const red = vivid([180, 40, 40], false) ?? ''
    expect(red).toMatch(/^#[0-9A-F]{6}$/)
    expect(contrast(red, '#FFFFFF')).toBeGreaterThanOrEqual(3)
    // Yellow on white: darkened until it reads.
    expect(contrast(vivid([230, 220, 40], false) ?? '', '#FFFFFF')).toBeGreaterThanOrEqual(3)
    expect(contrast(vivid([20, 30, 120], true) ?? '', '#121212')).toBeGreaterThanOrEqual(3)
    expect(vivid([120, 122, 125], true)).toBeNull()
  })
})
