import { expect, it, vi } from 'vitest'

const linkPending = vi.fn<() => Promise<string | null>>()
const openRemix = vi.fn()
const openRemixLink = vi.fn()
const setState = vi.fn()
vi.mock('../../shared/api', () => ({ api: { linkPending, onLink: () => Promise.resolve(() => {}) } }))
vi.mock('../../app/store', () => ({ useStore: { setState } }))
vi.mock('../editor/remixFile', () => ({ openRemix, openRemixLink }))
const { startOpenedLinks } = await import('./openedLink')
const settle = () => new Promise((r) => setTimeout(r, 10))

it('a double-clicked .lmix file opens as a dropped one; links as before; other text nowhere', async () => {
  for (const [text, call] of [
    [String.raw`C:\Users\me\My mixes\Été · remix.LMIX`, openRemix],
    ['legato://remix/abc', openRemixLink],
  ] as const) {
    linkPending.mockResolvedValueOnce(text)
    startOpenedLinks()()
    await settle()
    expect(call).toHaveBeenLastCalledWith(text)
  }
  linkPending.mockResolvedValueOnce(String.raw`C:\x\mix.exe`)
  startOpenedLinks()()
  await settle()
  expect(openRemix).toHaveBeenCalledOnce()
  expect(setState).not.toHaveBeenCalled()
})
