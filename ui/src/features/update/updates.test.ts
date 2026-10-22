import { expect, it, vi } from 'vitest'

// Store modules touch Tauri and window at load: only the pure check is under test.
vi.mock('../../app/settings', () => ({ useSettings: {} }))
vi.mock('../../app/store', () => ({ useStore: {} }))
vi.mock('../../shared/api', () => ({ api: {} }))
vi.mock('../player/session', () => ({ saveSessionNow: () => {}, saveSessionAtNext: () => {} }))
vi.mock('../player/store', () => ({ usePlayer: {}, onSongEnd: () => {} }))

const { betweenSongs, quietNow } = await import('./updates')

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
