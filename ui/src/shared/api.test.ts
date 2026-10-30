import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('api types', () => {
  const src = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8')

  it('are written from Rust (pnpm types), none by hand', () => {
    // `Service` is the one front-end subset of a generated type.
    expect(src.match(/^export (?:interface|type) \w+/gm)).toEqual(['export type Service'])
    expect(src).toContain("export * from './generated'")
  })

  it('name every result and payload instead of spelling a struct out', () => {
    expect(src.match(/(?:invoke|listen)<\{/g)).toBeNull()
  })
})
