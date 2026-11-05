import { describe, expect, it } from 'vitest'
import { cleanLookName, cleanOps, MAX_OPS, MAX_POINTS } from './drawList'

describe('plugin drawings', () => {
  it('keeps known shapes, clamps their numbers, drops the rest', () => {
    const ops = cleanOps([
      { op: 'rect', x: 0.1, y: 5, w: 0.2, h: 0.3, color: '#ff0000', alpha: 2 },
      { op: 'circle', x: 0.5, y: 0.5, r: 0.2, width: 3 },
      { op: 'line', points: [0, 0, 1, 1, 0.5], color: 'url(x)' },
      { op: 'text', x: 0.5, y: 0.1, text: 'Hi', align: 'middle', size: 1000 },
      { op: 'image', src: 'x' },
      'rect',
      null,
      { op: 'shape', points: [0, 0] },
    ])
    expect(ops).toEqual([
      { op: 'rect', x: 0.1, y: 2, w: 0.2, h: 0.3, color: '#ff0000', alpha: 1 },
      { op: 'circle', x: 0.5, y: 0.5, r: 0.2, width: 3, color: 'ink', alpha: 1 },
      { op: 'line', points: [0, 0, 1, 1], width: 1.5, color: 'ink', alpha: 1 },
      { op: 'text', x: 0.5, y: 0.1, text: 'Hi', size: 120, color: 'ink', alpha: 1, align: 'left' },
    ])
  })

  it('never more than its shapes and points, nothing from bad numbers', () => {
    expect(cleanOps(Array(MAX_OPS + 50).fill({ op: 'circle', x: 0, y: 0, r: 0.1 }))).toHaveLength(MAX_OPS)
    const long = { op: 'line', points: Array(MAX_POINTS * 2 + 10).fill(0.5) }
    const ops = cleanOps([long, long])
    expect(ops).toHaveLength(1)
    expect(ops[0].op === 'line' && ops[0].points.length).toBe(MAX_POINTS * 2)
    expect(cleanOps('draw')).toEqual([])
    expect(cleanOps([{ op: 'rect', x: NaN, y: Infinity, color: 'warn' }])).toEqual([{ op: 'rect', x: 0, y: 0, w: 0, h: 0, color: 'warn', alpha: 1 }])
  })

  it('names a look in a few words, the plugin name when it has none', () => {
    expect(cleanLookName('  Rings ', 'My plugin')).toBe('Rings')
    expect(cleanLookName('', 'My plugin')).toBe('My plugin')
    expect(cleanLookName('x'.repeat(80), 'P')).toHaveLength(40)
  })
})
