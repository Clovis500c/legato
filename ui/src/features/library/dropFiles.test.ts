import { beforeEach, expect, it, vi } from 'vitest'

const update = vi.fn()
const notify = vi.fn()
const answer = vi.fn()
const PALETTE = ['bg', 'panel', 'raised', 'recess', 'line', 'lineSoft', 'ink', 'ink2', 'ink3', 'ink4', 'accent', 'onAccent', 'ledOff']
vi.mock('../../app/settings', () => ({ useSettings: { getState: () => ({ settings: { customThemes: [] }, update }) } }))
vi.mock('../../app/store', () => ({ useStore: { getState: () => ({ notify }) } }))
vi.mock('../../shared/ui/Ask', () => ({ ask: () => answer() }))
vi.mock('../../shared/api', () => ({ api: { importTheme: async () => ({ name: 'Night', ...Object.fromEntries(PALETTE.map((k) => [k, '#112233'])) }) } }))
const { openDropped } = await import('./dropFiles')

beforeEach(() => {
  update.mockClear()
  answer.mockReset()
})

it('applies a dropped theme only once the user says so', async () => {
  answer.mockResolvedValue(false)
  await openDropped('theme', 'C:\\x\\night.theme')
  expect(update).not.toHaveBeenCalled()
  answer.mockResolvedValue(true)
  await openDropped('theme', 'C:\\x\\night.theme')
  expect(update).toHaveBeenCalledOnce()
})
