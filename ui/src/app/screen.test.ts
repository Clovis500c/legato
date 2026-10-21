import { describe, expect, it } from 'vitest'
import { startClosingPlayerOnNavigate, validScreen } from './screen'
import { usePlayer } from '../features/player/store'
import { useStore } from './store'

describe('validScreen', () => {
  it('keeps a screen that still exists', () => {
    expect(validScreen({ view: { name: 'playlist', id: 4 }, full: true }, [4])).toEqual({ view: { name: 'playlist', id: 4 }, full: true })
    expect(validScreen({ view: { name: 'songs' } }, [])).toEqual({ view: { name: 'songs' }, full: false })
    expect(validScreen({ view: { name: 'addons' } }, [])?.view).toEqual({ name: 'addons' })
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

describe('navigation and Now Playing', () => {
  it('any navigation closes the player (logo Home from the player)', () => {
    const stop = startClosingPlayerOnNavigate()
    usePlayer.setState({ full: true })
    useStore.getState().go({ name: 'home' })
    expect(usePlayer.getState().full).toBe(false)
    // Opening the player itself is not a navigation.
    usePlayer.setState({ full: true })
    expect(usePlayer.getState().full).toBe(true)
    stop()
  })
})
