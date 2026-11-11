import { describe, expect, it } from 'vitest'
import { flowSize } from './flow'

describe('flowSize', () => {
  it('draws a quarter each way, never an empty canvas', () => {
    expect(flowSize(1920, 1080)).toEqual([480, 270])
    expect(flowSize(1001, 3)).toEqual([251, 1])
    expect(flowSize(0, 0)).toEqual([1, 1])
  })
})
