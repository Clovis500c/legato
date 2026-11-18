import { describe, expect, it } from 'vitest'
import { discordText } from './discordDrop'

const data = (types: Record<string, string>) => ({ getData: (t: string) => types[t] ?? '' }) as DataTransfer

describe('what the page hands to Rust', () => {
  it('only text that starts with a Discord file link', () => {
    expect(discordText(data({ 'text/uri-list': 'https://cdn.discordapp.com/attachments/1/2/a.png?ex=1' }))).toContain('attachments')
    expect(discordText(data({ 'text/plain': 'https://media.discordapp.net/attachments/1/2/a.lmix' }))).not.toBeNull()
    expect(discordText(data({ 'text/plain': 'https://example.com/a.png' }))).toBeNull()
    expect(discordText(data({ 'text/plain': 'see https://cdn.discordapp.com/x' }))).toBeNull()
    expect(discordText(data({}))).toBeNull()
    expect(discordText(null)).toBeNull()
  })
})
