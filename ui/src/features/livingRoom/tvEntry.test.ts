import { describe, expect, it } from 'vitest'
import { startTvHome } from './tvEntry'

describe('TV home entry', () => {
  it('opens at launch when wanted, then once each time it becomes wanted again', () => {
    let on = true
    const subs = new Set<() => void>()
    let opened = 0
    const stop = startTvHome(() => on, (f) => (subs.add(f), () => subs.delete(f)), () => opened++)
    expect(opened).toBe(1)
    subs.forEach((f) => f())
    expect(opened).toBe(1)
    on = false
    subs.forEach((f) => f())
    on = true
    subs.forEach((f) => f())
    expect(opened).toBe(2)
    stop()
    expect(subs.size).toBe(0)
  })
  it('stays shut when not wanted', () => {
    let opened = 0
    startTvHome(() => false, () => () => {}, () => opened++)
    expect(opened).toBe(0)
  })
})
