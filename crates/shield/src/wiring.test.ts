import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// The Live Editor's parts wired in live.js (the block between fx:begin and fx:end).
const src = readFileSync(new URL('./live.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// fx:begin'), src.indexOf('// fx:end'))
type Fx = { drive: number; compress: number; echo: { mix: number }; reverb: { mix: number }; space: { on: boolean; room: number } }
type Node = { connect: (to: unknown) => void; disconnect: (to: unknown) => void }
const { parts, wire } = new Function(`${block}; return { parts, wire }`)() as {
  parts: (e: Fx, shift: number) => Record<string, boolean>
  wire: (from: Node, to: unknown, later?: boolean) => (want: boolean) => void
}

const rest: Fx = { drive: 0, compress: 0, echo: { mix: 0 }, reverb: { mix: 0 }, space: { on: false, room: 0.2 } }

describe('Live Editor wiring', () => {
  it('at rest, nothing beyond the always-cheap filters is wired', () => {
    expect(Object.values(parts(rest, 1)).some(Boolean)).toBe(false)
  })
  it('each part is wired by its own setting only', () => {
    expect(parts({ ...rest, reverb: { mix: 0.3 } }, 1)).toEqual({ shift: false, drive: false, comp: false, echo: false, reverb: true, space: false, room: false })
    expect(parts({ ...rest, space: { on: true, room: 0 } }, 1)).toMatchObject({ space: true, room: false })
    expect(parts({ ...rest, space: { on: true, room: 0.2 } }, 1)).toMatchObject({ space: true, room: true })
    expect(parts(rest, 2 ** (3 / 12)).shift).toBe(true)
    expect(parts({ ...rest, drive: 0.1, compress: 0.5, echo: { mix: 0.2 } }, 1)).toMatchObject({ drive: true, comp: true, echo: true })
  })
  it('wires once, unwires after the fade, and a quick change back keeps it wired', () => {
    vi.useFakeTimers()
    let edges = 0
    const from: Node = { connect: () => void edges++, disconnect: () => void edges-- }
    const link = wire(from, {})
    link(true)
    link(true)
    expect(edges).toBe(1)
    link(false)
    expect(edges).toBe(1)
    link(true)
    vi.advanceTimersByTime(1000)
    expect(edges).toBe(1)
    link(false)
    vi.advanceTimersByTime(1000)
    expect(edges).toBe(0)
    // At once (the distortion's two ways round): never both wired.
    const now = wire(from, {}, false)
    now(true)
    now(false)
    expect(edges).toBe(0)
    vi.useRealTimers()
  })
})
