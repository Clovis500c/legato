import { describe, expect, it } from 'vitest'
import { VISUALIZER_STYLES, type VisualizerStyle } from '../../shared/theme/theme'
import { BUILT_IN_LOOKS, nextLook } from './vizLooks'

describe('nextLook', () => {
  it('goes through every built-in look, then back to the first', () => {
    const seen: VisualizerStyle[] = [BUILT_IN_LOOKS[0]]
    for (let i = 1; i < BUILT_IN_LOOKS.length; i++) seen.push(nextLook(seen[i - 1]))
    expect(seen).toEqual([...BUILT_IN_LOOKS])
    expect(nextLook(BUILT_IN_LOOKS[BUILT_IN_LOOKS.length - 1])).toBe(BUILT_IN_LOOKS[0])
  })

  it('a plugin look is not in the round: from it, the first built-in one', () => {
    expect(BUILT_IN_LOOKS).toEqual(VISUALIZER_STYLES.filter((v) => v !== 'plugin'))
    expect(nextLook('plugin')).toBe(BUILT_IN_LOOKS[0])
  })
})
