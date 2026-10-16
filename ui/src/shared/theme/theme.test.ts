import { describe, expect, it } from 'vitest'
import { contrast, contrastReport, cssVars, DEFAULTS, PRESETS, resolveTheme, sanitize, sanitizeTheme } from './theme'

describe('sanitize', () => {
  it('falls back to defaults on junk', () => {
    expect(sanitize(null)).toEqual(DEFAULTS)
    expect(sanitize({ theme: 'nope', covers: 'hexagon', zoom: 'big', columns: ['album', 'evil', 'album'] })).toEqual({ ...DEFAULTS, columns: ['album'] })
    expect(sanitize({ theme: 'papier' }).theme).toBe('paper')
  })

  it('clamps zoom and keeps valid values', () => {
    const s = sanitize({ theme: 'studio', accent: '#2f6feb', zoom: 300, density: 'compact', readout: false })
    expect(s).toMatchObject({ theme: 'studio', accent: '#2F6FEB', zoom: 125, density: 'compact', readout: false })
  })

  it('keeps custom themes only with full palette', () => {
    const good = { ...PRESETS[1], id: 'custom-night', name: 'Yellow night', accent: '#F2B705' }
    const s = sanitize({ theme: 'custom-night', customThemes: [good, { ...good, bg: 'red' }] })
    expect(s.customThemes).toHaveLength(1)
    expect(s.theme).toBe('custom-night')
    expect(sanitizeTheme({ ...good, id: '../etc' })?.id).toMatch(/^custom-/)
  })
})

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21)
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  it('every preset passes AA for readable text', () => {
    for (const t of PRESETS) expect(contrastReport(t).filter((c) => !c.ok), t.id).toEqual([])
  })
})

describe('resolveTheme', () => {
  it('follows system and accent override', () => {
    expect(resolveTheme({ ...DEFAULTS, theme: 'system' }, true).id).toBe('graphite')
    const t = resolveTheme({ ...DEFAULTS, accent: '#F2B705' }, false)
    expect([t.accent, t.onAccent]).toEqual(['#F2B705', '#171614'])
  })

  it('maps layout settings to CSS variables', () => {
    const v = cssVars(PRESETS[0], { ...DEFAULTS, covers: 'vinyl', density: 'compact' })
    expect(v).toMatchObject({ '--bg': '#F3F1EC', '--line-soft': '#E4E0D7', '--ink-2': '#5C5852', '--cover-radius': '999px', '--row-h': '40px' })
  })
})
