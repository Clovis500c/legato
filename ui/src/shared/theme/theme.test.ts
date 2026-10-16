import { describe, expect, it } from 'vitest'
import { contrast, contrastReport, cssVars, DEFAULTS, onAccentFor, PRESETS, resolveTheme, sanitize, sanitizeTheme } from './theme'

describe('sanitize', () => {
  it('falls back to defaults on junk', () => {
    expect(sanitize(null)).toEqual(DEFAULTS)
    expect(sanitize({ theme: 'nope', covers: 'hexagon', zoom: 'big', columns: ['album', 'evil', 'album'] })).toEqual({ ...DEFAULTS, columns: ['album'] })
    expect(sanitize({ theme: 'papier' }).theme).toBe('paper')
  })

  it('defaults to Windows theme and accent, keeps an explicit theme accent', () => {
    expect(DEFAULTS).toMatchObject({ theme: 'system', accent: 'system' })
    expect(sanitize({ accent: null }).accent).toBeNull()
    expect(sanitize({ accent: 'system' }).accent).toBe('system')
    expect(sanitize({ accent: 'red' }).accent).toBe('system')
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
    expect(resolveTheme({ ...DEFAULTS, theme: 'system' }, true).id).toBe('modern-dark')
    expect(resolveTheme({ ...DEFAULTS, theme: 'system' }, false).id).toBe('modern')
    const t = resolveTheme({ ...DEFAULTS, accent: '#F2B705' }, false)
    expect([t.accent, t.onAccent]).toEqual(['#F2B705', '#171614'])
  })

  it('uses the Windows accent variant matching theme brightness', () => {
    const win = { light: '#005fb8', dark: '#60CDFF' }
    const light = resolveTheme(DEFAULTS, false, win)
    const dark = resolveTheme(DEFAULTS, true, win)
    expect([light.id, light.accent, light.onAccent]).toEqual(['modern', '#005FB8', '#FFFFFF'])
    expect([dark.id, dark.accent, dark.onAccent]).toEqual(['modern-dark', '#60CDFF', '#171614'])
    // No Windows accent (other OS, error): theme's own.
    expect(resolveTheme(DEFAULTS, true, null).accent).toBe('#FF0033')
    expect(resolveTheme({ ...DEFAULTS, accent: null }, false, win).accent).toBe('#FF0033')
  })

  it('text on any accent reaches AA 4.5', () => {
    for (let v = 0; v < 0x1000; v += 7) {
      const hex = '#' + [8, 4, 0].map((s) => ((v >> s) & 15).toString(16).repeat(2)).join('')
      expect(contrast(onAccentFor(hex), hex), hex).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('maps layout settings to CSS variables', () => {
    const paper = PRESETS.find((t) => t.id === 'paper')!
    const v = cssVars(paper, { ...DEFAULTS, covers: 'vinyl', density: 'compact' })
    expect(v).toMatchObject({ '--bg': '#F3F1EC', '--line-soft': '#E4E0D7', '--ink-2': '#5C5852', '--cover-radius': '999px', '--row-h': '40px' })
    expect(v['--font-ui']).toContain('Schibsted')
    expect(cssVars(paper, { ...DEFAULTS, font: 'modern' })['--font-ui']).toContain('Roboto')
  })

  it('sanitizes the new options', () => {
    expect(sanitize({ font: 'comic', clickToPlay: 'triple', startView: 'settings', motion: 'no' })).toMatchObject({ font: 'theme', clickToPlay: 'single', startView: 'songs', motion: true })
    expect(sanitize({ font: 'neutral', clickToPlay: 'double', startView: 'mixes', listCovers: false, defaultsVersion: 2 })).toMatchObject({ font: 'neutral', clickToPlay: 'double', startView: 'mixes', listCovers: false })
    expect(sanitize({ stage: 'cover', miniSpot: 'tl', crossfade: 40, resume: false, youtubeControls: true, defaultsVersion: 3 })).toMatchObject({ stage: 'cover', miniSpot: 'tl', crossfade: 12, resume: false, youtubeControls: true })
    expect(sanitize({ stage: 'radio', miniSpot: 'center', crossfade: -3, defaultsVersion: 3 })).toMatchObject({ stage: 'auto', miniSpot: 'br', crossfade: 0 })
  })

  it('settings saved before v2 get the new defaults once, later choices stay', () => {
    const old = sanitize({ volume: 'knob', tuner: true, clickToPlay: 'double', zoom: 110 })
    expect(old).toMatchObject({ volume: 'bar', tuner: false, clickToPlay: 'single', stage: 'auto', zoom: 110, defaultsVersion: 3 })
    // Saved at v2: only v3's change applies.
    expect(sanitize({ volume: 'knob', stage: 'video', defaultsVersion: 2 })).toMatchObject({ volume: 'knob', stage: 'auto' })
    // Chosen again after migration: kept.
    expect(sanitize({ ...old, volume: 'knob', clickToPlay: 'double' })).toMatchObject({ volume: 'knob', clickToPlay: 'double' })
  })
})
