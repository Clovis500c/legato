import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Via } from './sources'
import { remember, startVolumePerSource } from './volumePerSource'
import { usePlayer, type NowPlaying } from './store'

const now = (via: Via) => ({ title: 't', artist: 'a', via }) as NowPlaying
const play = (via: Via) => usePlayer.setState({ now: now(via) })

let stop = () => {}
let on = true
beforeEach(() => {
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) })
  on = true
  usePlayer.setState({ now: undefined, volume: 0.5 })
  stop = startVolumePerSource(() => on)
})
afterEach(() => stop())

it('remembers a volume, but not a mute', () => {
  expect(remember({}, 'local', 0.4)).toEqual({ local: 0.4 })
  expect(remember({ local: 0.4 }, 'local', 0)).toEqual({ local: 0.4 })
})

it('gives each source back the volume set on it', () => {
  play('local')
  usePlayer.getState().setVolume(0.3)
  play('youtube')
  // YouTube arrives at the volume it finds (0.3), then is turned up.
  expect(usePlayer.getState().volume).toBe(0.3)
  usePlayer.getState().setVolume(0.9)
  play('local')
  expect(usePlayer.getState().volume).toBe(0.3)
  play('youtube')
  expect(usePlayer.getState().volume).toBe(0.9)
})

it('does nothing while the setting is off, and a mute stays a mute for the source', () => {
  on = false
  play('local')
  usePlayer.getState().setVolume(0.2)
  play('youtube')
  expect(usePlayer.getState().volume).toBe(0.2)
  on = true
  play('local')
  usePlayer.getState().setVolume(0.6)
  usePlayer.getState().setVolume(0)
  play('youtube')
  play('local')
  // Another source's song never undoes the mute (0.6 comes back with the unmute).
  expect(usePlayer.getState().volume).toBe(0)
  usePlayer.getState().toggleMute()
  expect(usePlayer.getState().volume).toBe(0.6)
})

