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

  it('call commands the shell has, by their names', () => {
    // The wrappers are written by hand: a typo in a name would only show when the command is used.
    const shell = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')
    const list = /generate_handler!\[([^\]]+(?:\][^\]]+)*?)\]\)/.exec(shell)?.[1] ?? ''
    const known = new Set(list.split(',').map((c) => c.replace(/#\[[^\]]*\]/, '').trim().split('::').pop()))
    const asked = [...src.matchAll(/\binvoke(?:<[^(]*>)?\(\s*'(\w+)'/g)].map((m) => m[1])
    expect(known.size).toBeGreaterThan(200)
    // Every call read: none in a form this test can't see.
    expect(asked.length).toBe(src.match(/\binvoke[<(]/g)?.length)
    expect(asked.filter((name) => !known.has(name))).toEqual([])
  })

  it('name every result and payload instead of spelling a struct out', () => {
    expect(src.match(/(?:invoke|listen)<\{/g)).toBeNull()
  })
})
