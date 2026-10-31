import { describe, expect, it } from 'vitest'
import { contrast, contrastReport, cssVars, DEFAULTS, HOME_SECTIONS, lookOf, moveHome, placeHome, onAccentFor, paletteFrom, PRESETS, resolveTheme, sanitize, sanitizeHome, sanitizeTheme } from './theme'

describe('sanitize', () => {
  it('falls back to defaults on junk', () => {
    expect(sanitize(null)).toEqual(DEFAULTS)
    expect(sanitize({ theme: 'nope', covers: 'hexagon', zoom: 'big', columns: ['album', 'evil', 'album'] })).toEqual({ ...DEFAULTS, columns: ['album'] })
    expect(sanitize({ theme: 'papier' }).theme).toBe('paper')
  })

  it("defaults to Windows' light or dark with the theme's accent, keeps the Windows accent when picked", () => {
    expect(DEFAULTS).toMatchObject({ theme: 'system', accent: null })
    expect(sanitize({ accent: null }).accent).toBeNull()
    expect(sanitize({ accent: 'system', defaultsVersion: 8 }).accent).toBe('system')
    expect(sanitize({ accent: 'red' }).accent).toBeNull()
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
    const light = resolveTheme({ ...DEFAULTS, accent: 'system' }, false, win)
    const dark = resolveTheme({ ...DEFAULTS, accent: 'system' }, true, win)
    expect([light.id, light.accent, light.onAccent]).toEqual(['modern', '#005FB8', '#FFFFFF'])
    expect([dark.id, dark.accent, dark.onAccent]).toEqual(['modern-dark', '#60CDFF', '#171614'])
    // No Windows accent (other OS, error): theme's own.
    expect(resolveTheme({ ...DEFAULTS, accent: 'system' }, true, null).accent).toBe('#7CB8FF')
    expect(resolveTheme(DEFAULTS, false, win).accent).toBe('#7CB8FF')
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
    // Sky blue as text on white darkens until AA.
    const modern = cssVars(PRESETS[0], DEFAULTS)['--accent-ink']
    expect(contrast(modern, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(cssVars(paper, { ...DEFAULTS, font: 'modern' })['--font-ui']).toContain('Roboto')
  })

  it('sanitizes the new options', () => {
    expect(sanitize({ font: 'comic', clickToPlay: 'triple', startView: 'settings', motion: 'no' })).toMatchObject({ font: 'theme', clickToPlay: 'single', startView: 'home', motion: true })
    expect(sanitize({ font: 'neutral', clickToPlay: 'double', startView: 'mixes', listCovers: false, defaultsVersion: 4 })).toMatchObject({ font: 'neutral', clickToPlay: 'double', startView: 'mixes', listCovers: false })
    expect(sanitize({ stage: 'cover', miniSpot: 'tl', crossfade: 40, resume: false, youtubeControls: true, defaultsVersion: 3 })).toMatchObject({ stage: 'cover', miniSpot: 'tl', crossfade: 12, resume: false, youtubeControls: true })
    expect(sanitize({ stage: 'radio', miniSpot: 'center', crossfade: -3, defaultsVersion: 3 })).toMatchObject({ stage: 'auto', miniSpot: 'br', crossfade: 0 })
  })

  it('keeps the update channel to Stable or Beta, Stable unless Beta was picked', () => {
    expect(DEFAULTS.updateChannel).toBe('stable')
    expect(sanitize({ updateChannel: 'beta' }).updateChannel).toBe('beta')
    expect(sanitize({ updateChannel: 'nightly' }).updateChannel).toBe('stable')
    expect(sanitize({ autoUpdate: false }).updateChannel).toBe('stable')
  })

  it('the visualizer opens on LED bars; other looks stay, the old default moves once', () => {
    expect(sanitize({}).visualizerStyle).toBe('led')
    expect(sanitize({ visualizerStyle: 'bars', defaultsVersion: 8 }).visualizerStyle).toBe('led')
    expect(sanitize({ visualizerStyle: 'wave', defaultsVersion: 8 }).visualizerStyle).toBe('wave')
    for (const look of ['radial', 'vu', 'spectrogram']) expect(sanitize({ visualizerStyle: look, defaultsVersion: 9 }).visualizerStyle).toBe(look)
    expect(sanitize({ visualizerStyle: 'bars', defaultsVersion: 9 }).visualizerStyle).toBe('bars')
    expect(sanitize({ visualizerStyle: 'nonsense', defaultsVersion: 9 }).visualizerStyle).toBe('led')
  })

  it('settings saved before v2 get the new defaults once, later choices stay', () => {
    const old = sanitize({ volume: 'knob', tuner: true, clickToPlay: 'double', zoom: 110 })
    expect(old).toMatchObject({ volume: 'bar', tuner: false, clickToPlay: 'single', stage: 'auto', zoom: 110, startView: 'home', defaultsVersion: 9 })
    // Saved at v2: only v3's change applies.
    expect(sanitize({ volume: 'knob', stage: 'video', defaultsVersion: 2 })).toMatchObject({ volume: 'knob', stage: 'auto' })
    // Home opens first once (v4), then the user's pick stays.
    expect(sanitize({ startView: 'albums', defaultsVersion: 3 }).startView).toBe('home')
    expect(sanitize({ startView: 'albums', defaultsVersion: 4 }).startView).toBe('albums')
    // 2 s fades once (v5), only where the old 5 s defaults were never changed.
    expect(sanitize({ crossfade: 5, fade: { out: 5, in: 5 }, defaultsVersion: 4 })).toMatchObject({ crossfade: 2, fade: { out: 2, in: 2 } })
    expect(sanitize({ crossfade: 8, fade: { out: 8, in: 3 }, defaultsVersion: 4 })).toMatchObject({ crossfade: 8, fade: { out: 8, in: 3 } })
    expect(sanitize({ crossfade: 5, fade: { out: 5, in: 5 }, defaultsVersion: 5 })).toMatchObject({ crossfade: 5, fade: { out: 5, in: 5 } })
    // Your playlists off once (v6), back on when the user turns it on again.
    const off = (x: ReturnType<typeof sanitize>) => x.homeSections.find((h) => h.id === 'playlists')?.on
    expect(off(sanitize({ homeSections: [{ id: 'playlists', on: true }], defaultsVersion: 5 }))).toBe(false)
    expect(off(sanitize({ homeSections: [{ id: 'playlists', on: true }], defaultsVersion: 6 }))).toBe(true)
    // App v2 (v8): old defaults move once (Windows accent → sky blue, compact rows, square covers, flat Now Playing);
    // covers stay on the rows.
    expect(sanitize({ accent: 'system', density: 'comfort', listCovers: true, covers: 'rounded', immersive: true, defaultsVersion: 7 })).toMatchObject({ accent: null, density: 'compact', listCovers: true, covers: 'net', immersive: false })
    expect(sanitize({}).listCovers).toBe(true)
    expect(sanitize({ miniPlace: 'sidebar', defaultsVersion: 7 }).miniPlace).toBe('panel')
    expect(sanitize({ miniPlace: 'float', defaultsVersion: 7 }).miniPlace).toBe('float')
    expect(sanitize({ miniPlace: 'sidebar', defaultsVersion: 8 }).miniPlace).toBe('sidebar')
    expect(sanitize({ upNext: true, defaultsVersion: 7 }).upNext).toBe(false)
    expect(sanitize({ upNext: true, sidePanel: 'lyrics', defaultsVersion: 8 })).toMatchObject({ upNext: true, sidePanel: 'lyrics' })
    expect(sanitize({ sidePanel: 'editor' }).sidePanel).toBe('upNext')
    expect(sanitize({ accent: '#2F6FEB', density: 'airy', listCovers: true, covers: 'vinyl', defaultsVersion: 7 })).toMatchObject({ accent: '#2F6FEB', density: 'airy', listCovers: true, covers: 'vinyl' })
    expect(sanitize({ accent: 'system', immersive: true, defaultsVersion: 8 })).toMatchObject({ accent: 'system', immersive: true })
    // Plays column once (v7), only for the old default columns.
    expect(sanitize({ columns: ['album', 'sources', 'duration'], defaultsVersion: 6 }).columns).toEqual(['album', 'sources', 'plays', 'duration'])
    expect(sanitize({ columns: ['album'], defaultsVersion: 6 }).columns).toEqual(['album'])
    // Chosen again after migration: kept.
    expect(sanitize({ ...old, volume: 'knob', clickToPlay: 'double' })).toMatchObject({ volume: 'knob', clickToPlay: 'double' })
  })
})

describe('themes v2', () => {
  const base = { ...PRESETS[1], id: 'custom-x', name: 'Mine' }

  it('keeps a background, a look and CSS, drops bad ones', () => {
    const t = sanitizeTheme({ ...base, radius: 'round', background: { image: 'bg-0123456789abcdef.jpg', fit: 'tile', dim: 500, blur: 10, panels: 10 }, look: { covers: 'vinyl', density: 'huge', zoom: 125 }, css: '.a{color:red} @import url(x.css);' })!
    expect(t.radius).toBe('round')
    expect(t.background).toEqual({ image: 'bg-0123456789abcdef.jpg', fit: 'tile', dim: 90, blur: 10, panels: 40 })
    // Known look keys only; a bad value falls back to its default.
    expect(t.look).toEqual({ covers: 'vinyl', density: DEFAULTS.density })
    expect(t.css).toBe('.a{color:red}')
    const bad = sanitizeTheme({ ...base, background: { image: '../library.db' }, look: 'x', css: 7, radius: 'blob' })!
    expect([bad.background, bad.look, bad.css, bad.radius]).toEqual([undefined, undefined, undefined, 'soft'])
    expect(sanitizeTheme({ ...base, css: 'x'.repeat(30_000) })!.css!.length).toBe(20_000)
  })

  it('a picture behind makes surfaces see-through; corners follow the theme', () => {
    const plain = cssVars({ ...base, radius: 'sharp' }, DEFAULTS)
    expect(plain['--bg']).toBe(base.bg)
    expect(plain['--radius-lg']).toBe('3px')
    const pic = cssVars({ ...base, background: { image: 'bg-0123456789abcdef.png', fit: 'cover', dim: 30, blur: 0, panels: 70 } }, DEFAULTS)
    expect(pic['--bg']).toBe(`color-mix(in srgb, ${base.bg} 70%, transparent)`)
    expect(pic['--raised']).toContain('80%')
    expect(pic['--bg-solid']).toBe(base.bg)
  })

  it('a palette from one color passes the contrast checks', () => {
    for (const accent of ['#FF5A1F', '#2F6FEB', '#F2B705', '#1F7A4D', '#9B5DE5', '#111111', '#FFFFFF'])
      for (const dark of [false, true]) {
        const p = paletteFrom(accent, dark)
        expect(contrastReport(p).filter((c) => !c.ok && c.label !== 'Icon on accent'), `${accent} ${dark}`).toEqual([])
        expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('lookOf takes the look settings only', () => {
    const look = lookOf({ ...DEFAULTS, covers: 'vinyl' })
    expect(look.covers).toBe('vinyl')
    expect('zoom' in look).toBe(false)
  })
})

describe('Home sections', () => {
  it('keeps the saved order, adds new sections where they belong, drops unknown and repeated ones', () => {
    expect(sanitizeHome(undefined).map((x) => x.id)).toEqual([...HOME_SECTIONS])
    expect(sanitizeHome(undefined).find((x) => x.id === 'playlists')?.on).toBe(false)
    const saved = [{ id: 'added', on: true }, { id: 'quick', on: false }, { id: 'nope', on: true }, { id: 'added', on: false }]
    const got = sanitizeHome(saved)
    expect(got.slice(0, 2)).toEqual([{ id: 'added', on: true }, { id: 'quick', on: false }])
    expect(got.map((x) => x.id).sort()).toEqual([...HOME_SECTIONS].sort())
    // week and mixes come right after quick, their neighbors in the default order.
    expect(got.slice(2, 4).map((x) => x.id)).toEqual(['week', 'mixes'])
  })
  it('moves a section up or down, not past the ends', () => {
    const l = sanitizeHome(undefined)
    expect(moveHome(l, 'week', -1).map((x) => x.id).slice(0, 2)).toEqual(['week', 'quick'])
    expect(moveHome(l, 'quick', -1)).toBe(l)
    // Dragged: dropped before the section at the slot, or last.
    expect(placeHome(l, 'quick', 3).map((x) => x.id).slice(0, 3)).toEqual([l[1].id, l[2].id, 'quick'])
    expect(placeHome(l, l[3].id, 0)[0].id).toBe(l[3].id)
    expect(placeHome(l, 'quick', 1)).toBe(l)
    expect(placeHome(l, 'quick', l.length).at(-1)?.id).toBe('quick')
    expect(moveHome(l, 'added', 1)).toBe(l)
  })
})
