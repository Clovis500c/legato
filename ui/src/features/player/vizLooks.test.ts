import { describe, expect, it } from 'vitest'
import { VISUALIZER_STYLES, type VisualizerStyle } from '../../shared/theme/theme'
import { nextLook } from './vizLooks'

describe('nextLook', () => {
  it('goes through every look, then back to the first', () => {
    const seen: VisualizerStyle[] = [VISUALIZER_STYLES[0]]
    for (let i = 1; i < VISUALIZER_STYLES.length; i++) seen.push(nextLook(seen[i - 1]))
    expect(seen).toEqual([...VISUALIZER_STYLES])
    expect(nextLook(VISUALIZER_STYLES[VISUALIZER_STYLES.length - 1])).toBe(VISUALIZER_STYLES[0])
  })
})
