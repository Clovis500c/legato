import { describe, expect, it } from 'vitest'
import { readMilk } from './vizMilk'
import { createPreset } from './vizPreset'

// A made-up preset in MilkDrop's file layout: values we read, values we leave out, equations out of order.
const MILK = `[preset00]
fRating=3.000000
fGammaAdj=1.500000
fDecay=0.950000
nWaveMode=3
bWaveDots=1
zoom=1.010000
warp=0.500000
wave_r=0.200000
fShader=0.000000
nMotionVectorsX=12.000000
per_frame_init_1=q1 = 2;
per_frame_2=rot = rot + 0.01 * bass;
per_frame_1=zoom = zoom + 0.02 * sin(time);
per_pixel_1=dx = 0.01 * rad;
wavecode_0_enabled=1
warp_1=\`shader_body {
`

describe('.milk files', () => {
  it('reads the values and equations our engine has', () => {
    const want = {
      name: 'Some preset',
      base: { gamma: 1.5, decay: 0.95, wave_mode: 3, wave_usedots: 1, zoom: 1.01, warp: 0.5, wave_r: 0.2 },
      init: 'q1 = 2;',
      frame: 'zoom = zoom + 0.02 * sin(time);\nrot = rot + 0.01 * bass;',
      vertex: 'dx = 0.01 * rad;',
    }
    expect(readMilk(MILK, 'Some preset')).toEqual(want)
    expect(readMilk(MILK.replace(/\n/g, '\r\n'), 'Some preset')).toEqual(want)
    expect(createPreset(want).errors).toEqual([null, null, null])
  })

  it('finds nothing in a file that is no preset', () => {
    expect(readMilk('hello', 'x')).toBeNull()
    expect(readMilk('[preset00]\nfRating=3\nunknown=1', 'x')).toBeNull()
    expect(readMilk('zoom=1'.padEnd(300_000, ' '), 'x')).toBeNull()
  })
})
