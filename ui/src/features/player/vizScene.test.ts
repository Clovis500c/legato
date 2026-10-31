import { describe, expect, it } from 'vitest'
import { swingsPerSecond } from './flash'
import { createScene } from './vizScene'
import { VIZ_BANDS } from './vizUnpack'

const bands = (db: number, at?: number, hot = -6) => Float32Array.from({ length: VIZ_BANDS }, (_, i) => (i === at ? hot : db))

describe('visualizer scene', () => {
  it('a sine in one band lights its column and not the far ones', () => {
    const scene = createScene(61, false)
    const f = bands(-120, 34, -10)
    scene.frame(f, f)
    let out = scene.step(1 / 60)
    for (let i = 0; i < 20; i++) out = scene.step(1 / 60)
    expect(out.levels[34]).toBeGreaterThan(0.9)
    expect(out.levels[5]).toBe(0)
    expect(out.levels[60]).toBe(0)
    expect(out.resting).toBe(false)
  })

  it('silence lets everything fall, then it rests', () => {
    const scene = createScene(30, false)
    const f = bands(-20)
    scene.frame(f, f)
    for (let i = 0; i < 30; i++) scene.step(1 / 60)
    scene.silence()
    let resting = false
    for (let i = 0; i < 60 * 6 && !resting; i++) resting = scene.step(1 / 60).resting
    expect(resting).toBe(true)
  })

  it('a strobing signal never flashes the bars more than 3 times a second', () => {
    const scene = createScene(40, false)
    const loud = bands(-12)
    const quiet = bands(-120)
    // The screen was dark before the first frame.
    const shown: number[] = [0]
    for (let i = 0; i < 60 * 5; i++) {
      const on = Math.floor((i / 60) * 20) % 2 === 0
      scene.frame(on ? loud : quiet, on ? loud : quiet)
      const { levels } = scene.step(1 / 60)
      shown.push(levels.reduce((a, b) => a + b, 0) / levels.length)
    }
    expect(Math.max(...shown)).toBeGreaterThan(0.2)
    expect(swingsPerSecond(shown, 60)).toBeLessThanOrEqual(6)
  })

  it('reduced motion moves slower', () => {
    const calm = createScene(10, true)
    const normal = createScene(10, false)
    const f = bands(-20)
    calm.frame(f, f)
    normal.frame(f, f)
    for (let i = 0; i < 6; i++) {
      calm.step(1 / 60)
      normal.step(1 / 60)
    }
    expect(calm.step(1 / 60).levels[0]).toBeLessThan(normal.step(1 / 60).levels[0])
  })
})
