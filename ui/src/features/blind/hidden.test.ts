import { expect, it, vi } from 'vitest'

const mediaUpdate = vi.fn(() => Promise.resolve())
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock('../../shared/api', async (real) => ({ ...(await real<object>()), api: { mediaUpdate } }))

it("Windows' media panel never shows the song a blind test plays, and gets it back after", async () => {
  vi.stubGlobal('window', {})
  const { usePlayer } = await import('../player/store')
  const { startMedia } = await import('../player/media')
  const { openBlind, closeBlind } = await import('./blindOpen')
  const stop = startMedia()
  openBlind()
  usePlayer.setState({ now: { title: 'Secret', artist: 'A', trackId: 3, via: 'local' }, playing: true })
  expect(mediaUpdate.mock.calls.every((c: unknown[]) => c[0] === null)).toBe(true)
  closeBlind()
  expect(mediaUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Secret' }), null, null)
  stop()
})
