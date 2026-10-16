import { describe, expect, it } from 'vitest'
import { validScreen } from './screen'

describe('validScreen', () => {
  it('keeps a screen that still exists', () => {
    expect(validScreen({ view: { name: 'playlist', id: 4 }, full: true }, [4])).toEqual({ view: { name: 'playlist', id: 4 }, full: true })
    expect(validScreen({ view: { name: 'songs' } }, [])).toEqual({ view: { name: 'songs' }, full: false })
  })

  it('drops deleted playlists and junk', () => {
    expect(validScreen({ view: { name: 'playlist', id: 9 } }, [4])).toBeNull()
    expect(validScreen({ view: { name: 'hack' } }, [])).toBeNull()
    expect(validScreen('x', [])).toBeNull()
  })

  it('settings reopen on the section only', () => {
    expect(validScreen({ view: { name: 'settings', section: 'advanced', focus: 'Theme', wizard: 'spotify' } }, [])?.view).toEqual({ name: 'settings', section: 'advanced' })
  })
})
