import { describe, expect, it } from 'vitest'
import { frameMessage } from './vizProtocol'
import { silentViz, VIZ_BANDS } from './vizUnpack'

describe('frame message', () => {
  it('a silent frame is silence, so the worker can stop its loop', () => {
    expect(frameMessage(silentViz())).toEqual({ t: 'silence' })
  })

  it('a frame with sound goes over with its window RMS', () => {
    const f = silentViz()
    f.left = new Float32Array(VIZ_BANDS).fill(-40)
    f.rms = [-20, -120]
    const m = frameMessage(f)
    expect(m.t).toBe('frame')
    expect(m.t === 'frame' && m.rms).toEqual([-20, -120])
  })
})
