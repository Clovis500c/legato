import { describe, expect, it } from 'vitest'
import { activeTab, PHONE_TABS, phoneTabs } from './tabLogic'

describe('the phone’s bottom tabs', () => {
  it('Home, Search, Your library, Mixes and Radio, in that order (the sidebar, which holds Radio on a PC, is hidden on a phone)', () => {
    expect(PHONE_TABS).toEqual(['home', 'search', 'library', 'mixes', 'radio'])
  })
  it('the tab of the page showing; the library tab while the library column is open wide; none for another page', () => {
    expect(activeTab('home', false)).toBe('home')
    expect(activeTab('search', false)).toBe('search')
    expect(activeTab('mixes', false)).toBe('mixes')
    expect(activeTab('mix', false)).toBe('mixes')
    expect(activeTab('radio', false)).toBe('radio')
    expect(activeTab('home', true)).toBe('library')
    expect(activeTab('radio', true)).toBe('library')
    expect(activeTab('settings', false)).toBeNull()
  })
  it('the sidebar entries hidden in Settings are hidden here too; Search and Your library never are, so a tab is always left', () => {
    expect(phoneTabs([])).toEqual(PHONE_TABS)
    expect(phoneTabs(['radio'])).toEqual(['home', 'search', 'library', 'mixes'])
    expect(phoneTabs(['home', 'mixes', 'radio', 'stats', 'add'])).toEqual(['search', 'library'])
  })
})
