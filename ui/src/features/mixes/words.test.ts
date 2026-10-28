import { afterEach, describe, expect, it } from 'vitest'
import type { Mix } from '../../shared/api'
import { loadLang, useLang } from '../../shared/i18n/i18n'
import { mixReason, mixTitle, weekdayName } from './words'

const mix = (id: string, words: Mix['words'], title = 'T', reason = 'R'): Mix => ({ id, title, reason, trackIds: [], kind: 'daily', words })

describe('mix words', () => {
  afterEach(() => useLang.setState({ lang: 'en' }))

  it('words mixes in English', () => {
    expect(mixTitle(mix('daily-2', { number: 2, names: ['A', 'B', 'C'] }))).toBe('Daily Mix 2')
    expect(mixReason(mix('daily-2', { number: 2, names: ['A', 'B', 'C'] }))).toBe('Because you listen to A, B, and C')
    expect(mixTitle(mix('weekday', { day: 5 }))).toBe('Your Fridays')
    expect(mixReason(mix('artist-1', { name: 'Daft Punk' }))).toBe('All Daft Punk, your way')
    expect(mixTitle(mix('now', { slot: 'night' }))).toBe('Your nights')
    // Unknown to the UI: Rust's own words.
    expect(mixTitle(mix('future-kind', {}, 'Something new'))).toBe('Something new')
  })

  it('words mixes in French', async () => {
    await loadLang('fr')
    useLang.setState({ lang: 'fr' })
    expect(mixReason(mix('daily-1', { number: 1, names: ['A', 'B', 'C'] }))).toBe('Parce que vous écoutez A, B et C')
    expect(mixTitle(mix('weekday', { day: 5 }))).toBe('Vos vendredis')
    expect(mixTitle(mix('artist-1', { name: 'Daft Punk' }))).toBe('Mix Daft Punk')
    expect(weekdayName(0)).toBe('dimanche')
  })
})
