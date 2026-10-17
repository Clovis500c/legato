import { describe, expect, it } from 'vitest'
import { searchSettings, SETTINGS_INDEX } from './search'

const labels = (q: string) => searchSettings(q).map((e) => e.label)

describe('settings search', () => {
  it('finds by label or keyword, every word must match', () => {
    expect(labels('fade')[0]).toBe('Fade between songs')
    expect(labels('crossfade')).toContain('Fade between songs')
    expect(labels('resume')).toEqual(['Resume playback on launch'])
    expect(labels('google playlists')).toEqual(['YouTube Music'])
    expect(labels('credits')).toEqual(['Third-party licenses'])
    expect(labels('zzz')).toEqual([])
    expect(labels('  ')).toEqual([])
  })

  it('ignores case and accents', () => {
    expect(labels('THÈME')).toContain('Theme')
  })

  it('label matches come before keyword matches', () => {
    const r = labels('cover')
    expect(r.indexOf('Covers')).toBeLessThan(r.indexOf('Fade between songs') === -1 ? Infinity : r.indexOf('Fade between songs'))
    expect(r.slice(0, 3)).toEqual(['Covers', 'Cover tint', 'Covers in lists'])
  })

  it('labels are unique per section (highlight target)', () => {
    const keys = SETTINGS_INDEX.map((e) => `${e.section}/${e.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
