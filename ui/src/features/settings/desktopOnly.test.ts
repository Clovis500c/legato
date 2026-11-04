import { describe, expect, it } from 'vitest'
import { DESKTOP_ONLY } from './desktopOnly'
import { SETTINGS_INDEX } from './search'

describe('desktop-only settings', () => {
  it('names rows the settings search knows', () => {
    const labels = new Set(SETTINGS_INDEX.map((e) => e.label))
    for (const id of DESKTOP_ONLY) expect(labels.has(id), id).toBe(true)
  })
})
