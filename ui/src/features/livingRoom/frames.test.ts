import { expect, it, vi } from 'vitest'

vi.mock('../../app/store', () => ({ useStore: { getState: () => ({}) } }))
vi.mock('../player/store', () => ({ usePlayer: { getState: () => ({}) } }))

it('asks for no frame while the mode is off, and polls the gamepad once it is on', async () => {
  const raf = vi.fn(() => 1)
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('navigator', { getGamepads: () => [] })
  vi.stubGlobal('document', { documentElement: { classList: { toggle: () => {}, remove: () => {} } } })
  const { startLivingRoom } = await import('./livingRoom')
  let on = false
  let changed = () => {}
  const stop = startLivingRoom(
    () => on,
    (f) => ((changed = f), () => {}),
  )
  expect(raf).not.toHaveBeenCalled()
  on = true
  changed()
  changed()
  // One loop, not one per settings change.
  expect(raf).toHaveBeenCalledTimes(1)
  stop()
  vi.unstubAllGlobals()
})
