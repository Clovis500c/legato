import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p }))
const { frameDiff, isStill } = await import('./still')

const frame = (v: number, n = 16) => new Uint8ClampedArray(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? 255 : v)))

describe('still image detection', () => {
  it('measures difference 0..1', () => {
    expect(frameDiff(frame(10), frame(10))).toBe(0)
    expect(frameDiff(frame(0), frame(255))).toBe(1)
  })

  it('JPEG-noise-level changes are a still, real changes a video', () => {
    expect(isStill([frame(100), frame(103), frame(98)])).toBe(true)
    expect(isStill([frame(100), frame(103), frame(160)])).toBe(false)
  })
})
