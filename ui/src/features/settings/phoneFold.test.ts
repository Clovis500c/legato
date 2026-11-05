import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHONE_FOLDED } from './phoneFold'

describe('phone-folded settings groups', () => {
  it('names groups the settings page has', () => {
    const page = readFileSync(new URL('./SettingsView.tsx', import.meta.url), 'utf8')
    for (const id of PHONE_FOLDED) expect(page.includes(`<Group title={msg('${id}')}`), id).toBe(true)
  })
})
