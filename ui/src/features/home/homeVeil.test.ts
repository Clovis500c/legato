import { describe, expect, it } from 'vitest'
import { BASE_DIM, contrastOver, homeVeil, MAX_DIM, parseColor } from './homeVeil'

// Modern (light) and Modern Dark: styles.css.
const LIGHT = { bg: [255, 255, 255] as const, ink: [15, 15, 15] as const, ink2: [86, 86, 86] as const }
const DARK = { bg: [19, 19, 19] as const, ink: [241, 241, 241] as const, ink2: [179, 179, 179] as const }
const COVERS: [number, number, number][] = [[255, 255, 255], [0, 0, 0], [255, 255, 0], [0, 200, 255], [250, 40, 40], [120, 70, 110], [128, 128, 128]]

describe('the veil over Home’s backdrop', () => {
  it('keeps the body text readable (4.5:1) over any cover, light and dark', () => {
    for (const theme of [LIGHT, DARK]) for (const cover of COVERS) {
      const dim = homeVeil(cover, theme.bg, theme.ink2)
      expect(dim).toBeGreaterThanOrEqual(BASE_DIM)
      expect(dim).toBeLessThanOrEqual(MAX_DIM)
      expect(contrastOver(cover, theme.bg, dim, theme.ink), `${theme.ink} ${cover}`).toBeGreaterThanOrEqual(4.5)
      expect(contrastOver(cover, theme.bg, dim, theme.ink2), `${theme.ink2} ${cover}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('stays at the base veil for a dark cover on a dark theme, and thickens for the brightest', () => {
    expect(homeVeil([120, 70, 110], DARK.bg, DARK.ink2)).toBe(BASE_DIM)
    expect(homeVeil([255, 255, 255], DARK.bg, DARK.ink2)).toBeGreaterThan(BASE_DIM)
    expect(homeVeil([0, 0, 0], LIGHT.bg, LIGHT.ink2)).toBeGreaterThan(BASE_DIM)
  })

  it('has no cover colour, no theme colour: the base veil (today’s)', () => {
    expect(homeVeil(null, DARK.bg, DARK.ink2)).toBe(BASE_DIM)
    expect(homeVeil([255, 255, 255], null, null)).toBe(BASE_DIM)
  })

  it('reads the theme’s colours: hex, short hex, rgb()', () => {
    expect(parseColor('#131313')).toEqual([19, 19, 19])
    expect(parseColor(' #fff ')).toEqual([255, 255, 255])
    expect(parseColor('rgb(10 20 30)')).toEqual([10, 20, 30])
    expect(parseColor('rgb(10, 20, 30 / 0.5)')).toEqual([10, 20, 30])
    expect(parseColor('hsl(0 0% 0%)')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})
