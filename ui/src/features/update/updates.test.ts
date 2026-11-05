import { expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../shared/api'

// Store modules touch Tauri and window at load: only the pure check is under test.
vi.mock('../../app/settings', () => ({ useSettings: {} }))
vi.mock('../../app/store', () => ({ useStore: {} }))
vi.mock('../../shared/api', () => ({ api: {} }))
vi.mock('../player/session', () => ({ saveSessionNow: () => {}, saveSessionAtNext: () => {} }))
vi.mock('../player/store', () => ({ usePlayer: {}, onSongEnd: () => {} }))

const { betweenSongs, quietNow, phoneStep } = await import('./updates')

it('installs only when nothing plays and nobody touched the app lately', () => {
  const now = 1_000_000
  expect(quietNow(now, { playing: false, lastSound: now - 20_000, lastInput: now - 90_000 })).toBe(true)
  expect(quietNow(now, { playing: true, lastSound: now, lastInput: now - 90_000 })).toBe(false)
  // Just paused: wait a little.
  expect(quietNow(now, { playing: false, lastSound: now - 3_000, lastInput: now - 90_000 })).toBe(false)
  // Someone is using the app.
  expect(quietNow(now, { playing: false, lastSound: now - 20_000, lastInput: now - 10_000 })).toBe(false)
})

it('installs between two songs only when nobody is using the app', () => {
  const now = 1_000_000
  expect(betweenSongs(now, now - 61_000)).toBe(true)
  expect(betweenSongs(now, now - 5_000)).toBe(false)
})

it('offers a new version once on the phone, and installs only a download asked for', () => {
  const st = (s: object) => ({ current: '1.1.679', lastCheck: null, lastUpdate: null, justUpdated: false, ...s }) as UpdateStatus
  const available = st({ state: 'available', version: '1.1.700', notes: null })
  expect(phoneStep(available, false, new Set())).toBe('offer')
  // Said once this run: the 6-hour check finds it again, quietly.
  expect(phoneStep(available, false, new Set(['1.1.700']))).toBe(null)
  expect(phoneStep(st({ state: 'available', version: '1.1.701', notes: null }), false, new Set(['1.1.700']))).toBe('offer')
  // Tapped while a check ran: its answer starts the download.
  expect(phoneStep(available, true, new Set(['1.1.700']))).toBe('download')
  const ready = st({ state: 'ready', version: '1.1.700', notes: null })
  expect(phoneStep(ready, true, new Set())).toBe('install')
  expect(phoneStep(ready, false, new Set())).toBe(null)
  const failed = st({ state: 'error', message: 'APK cut short' })
  expect(phoneStep(failed, true, new Set())).toBe('failed')
  // A background check that failed says nothing.
  expect(phoneStep(failed, false, new Set())).toBe(null)
})
