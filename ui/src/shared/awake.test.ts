import { describe, expect, it } from 'vitest'
import { makeAwake, type AwakeEnv } from './awake'

/** Fake page: requests answered by hand, visibility switched by hand. */
function page() {
  const pending: ((l: { released: boolean; release(): Promise<void> }) => void)[] = []
  const locks: { released: boolean; release(): Promise<void> }[] = []
  let shown = true
  let listener: (() => void) | null = null
  const env: AwakeEnv = {
    request: () =>
      new Promise((ok) => {
        pending.push(ok)
      }),
    visible: () => shown,
    onVisibility: (f) => {
      listener = f
      return () => {
        listener = null
      }
    },
  }
  const grant = async () => {
    const l = {
      released: false,
      release: async () => {
        l.released = true
      },
    }
    locks.push(l)
    pending.shift()?.(l)
    await Promise.resolve()
    return l
  }
  const show = (v: boolean) => {
    shown = v
    // The browser drops a held lock when the page hides.
    if (!v) for (const l of locks) l.released = true
    listener?.()
  }
  return { env, pending, grant, show, listening: () => listener !== null }
}

describe('makeAwake', () => {
  it('takes the lock when wanted and lets it go when not', async () => {
    const p = page()
    const a = makeAwake(p.env)
    expect(p.pending).toHaveLength(0)
    a.set(true)
    expect(p.pending).toHaveLength(1)
    const l = await p.grant()
    a.set(true)
    expect(p.pending).toHaveLength(0)
    a.set(false)
    expect(l.released).toBe(true)
  })

  it('asks once while a request is out, and lets a late lock go', async () => {
    const p = page()
    const a = makeAwake(p.env)
    a.set(true)
    a.set(true)
    expect(p.pending).toHaveLength(1)
    a.set(false)
    const late = await p.grant()
    expect(late.released).toBe(true)
  })

  it('takes it again when the page shows after hiding', async () => {
    const p = page()
    const a = makeAwake(p.env)
    a.set(true)
    await p.grant()
    p.show(false)
    expect(p.pending).toHaveLength(0)
    p.show(true)
    expect(p.pending).toHaveLength(1)
    a.dispose()
    expect(p.listening()).toBe(false)
  })

  it('waits for the page to show when wanted while hidden', () => {
    const p = page()
    const a = makeAwake(p.env)
    p.show(false)
    a.set(true)
    expect(p.pending).toHaveLength(0)
    p.show(true)
    expect(p.pending).toHaveLength(1)
  })

  it('does nothing without the Wake Lock API', () => {
    const p = page()
    const a = makeAwake({ ...p.env, request: null })
    a.set(true)
    expect(p.pending).toHaveLength(0)
  })
})
