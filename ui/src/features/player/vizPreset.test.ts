import { describe, expect, it } from 'vitest'
import { cleanPreset, createMusic, createPreset, emptyFrame, meshFor, WAVE_POINTS, wavePoints, type PresetData, type PresetFrame, type PresetInput } from './vizPreset'
import { BUILT_IN_PRESETS, FIRST_PRESET } from './vizPresets'
import { bandHz } from './vizUnpack'

const still: PresetInput = { time: 0, dt: 1 / 60, bass: 1, mid: 1, treb: 1, bassAtt: 1, midAtt: 1, trebAtt: 1, beat: false, bpm: 0, aspect: 1 }
/** A preset with no warp, so the mesh moves by its equations only. */
const preset = (p: Partial<PresetData>): PresetData => ({ name: 'Test', init: '', frame: '', vertex: '', ...p, base: { warp: 0, ...p.base } })
/** Where the mesh point at column i, row j takes its colour. */
const source = (out: PresetFrame, i: number, j: number) => {
  const n = j * (out.cols + 1) + i
  return [out.uv[2 * n], out.uv[2 * n + 1]]
}
const step = (p: Partial<PresetData>, input: Partial<PresetInput> = {}) => {
  const out = emptyFrame()
  createPreset(preset(p)).step({ ...still, ...input }, out)
  return out
}

describe('preset engine', () => {
  it('leaves the last picture where it was with no motion', () => {
    const out = step({})
    expect([out.cols, out.rows]).toEqual([32, 24])
    for (const [i, j] of [[0, 0], [16, 12], [32, 24], [5, 20]]) {
      const [u, v] = source(out, i, j)
      expect(u).toBeCloseTo(i / 32, 6)
      expect(v).toBeCloseTo(j / 24, 6)
    }
    expect(out.fade).toBeCloseTo(0.98, 6)
  })

  it('zooms, turns and moves by the 60th of a second', () => {
    expect(source(step({ base: { zoom: 2 } }), 0, 0)[0]).toBeCloseTo(0.25, 6)
    // Two 60ths: twice as far, the picture 4 times as big.
    expect(source(step({ base: { zoom: 2 } }, { dt: 1 / 30 }), 0, 0)[0]).toBeCloseTo(0.375, 6)
    expect(step({ base: { decay: 0.9 } }, { dt: 1 / 30 }).fade).toBeCloseTo(0.81, 6)
    // Counter-clockwise: the right edge's middle takes from the bottom's; in a wide box from below it (circles stay round).
    const [u, v] = source(step({ base: { rot: Math.PI / 2 } }), 32, 12)
    expect([u, v].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.5, 1])
    expect(source(step({ base: { rot: Math.PI / 2 } }, { aspect: 2 }), 32, 12)[1]).toBeCloseTo(1.5, 6)
    const [u2, v2] = source(step({ base: { dx: 0.1, dy: -0.05 } }), 16, 12)
    expect(u2).toBeCloseTo(0.4, 6)
    expect(v2).toBeCloseTo(0.55, 6)
  })

  it('starts each frame from the starting values, the equations’ own variables kept', () => {
    const run = createPreset(preset({ base: { zoom: 1.5 }, init: 'n = 10', frame: 'zoom = zoom * 2; n = n + 1; wave_a = n / 100; wave_x = bass' }))
    const out = emptyFrame()
    for (let i = 0; i < 3; i++) run.step({ ...still, bass: 0.7 }, out)
    expect(source(out, 0, 0)[0]).toBeCloseTo(0.5 - 0.5 / 3, 6)
    expect(out.wave.a).toBeCloseTo(0.13, 6)
    expect(out.wave.x).toBeCloseTo(0.7, 6)
  })

  it('bends the motion by place with the point equations', () => {
    const out = step({ vertex: 'zoom = 1 + x' })
    expect(source(out, 0, 12)[0]).toBeCloseTo(0, 6)
    expect(source(out, 32, 12)[0]).toBeCloseTo(0.75, 6)
  })

  it('says which equations are wrong, the others still running', () => {
    const run = createPreset(preset({ frame: 'zoom = ;', vertex: 'dx = 0.1' }))
    expect(run.errors).toEqual([null, 'line 1: unexpected ";"', null])
    const out = emptyFrame()
    run.step(still, out)
    expect(source(out, 16, 12)[0]).toBeCloseTo(0.4, 6)
  })

  it('takes fewer points for long point equations', () => {
    expect([meshFor(0), meshFor(48), meshFor(200), meshFor(4000)]).toEqual([[32, 24], [32, 24], [16, 12], [12, 9]])
  })

  it('runs every built-in preset without an error or a number out of place', () => {
    expect(Object.keys(BUILT_IN_PRESETS)).toContain(FIRST_PRESET)
    for (const [id, data] of Object.entries(BUILT_IN_PRESETS)) {
      const run = createPreset(data)
      expect(run.errors, id).toEqual([null, null, null])
      const out = emptyFrame()
      for (let i = 0; i < 120; i++) {
        const swing = 1 + Math.sin(i / 7)
        run.step({ ...still, time: i / 30, dt: 1 / 30, bass: swing, bassAtt: swing, treb: 2 - swing, beat: i % 15 === 0, aspect: 16 / 9 }, out)
      }
      expect(out.uv.every(Number.isFinite), id).toBe(true)
      expect(out.fade, id).toBeGreaterThan(0.5)
      expect(out.fade, id).toBeLessThanOrEqual(1)
    }
  })

  it('cleans a preset from anything', () => {
    expect(cleanPreset({ name: '  Hi ', base: { zoom: 1.1, nope: 3, toString: 1, decay: 'x' }, frame: 'a = 1', vertex: 5 })).toEqual({ name: 'Hi', base: { zoom: 1.1 }, init: '', frame: 'a = 1', vertex: '' })
    expect(cleanPreset(null)).toBeNull()
    expect(cleanPreset({ base: {} })).toBeNull()
    expect(cleanPreset({}, 'From a file')?.name).toBe('From a file')
  })
})

describe('preset wave', () => {
  const quiet = new Float32Array(512)
  const wave = (mode: number, l = quiet, r = quiet, more: Partial<PresetFrame['wave']> = {}) => {
    const out = new Float32Array(2 * (WAVE_POINTS + 1))
    const n = wavePoints({ ...emptyFrame().wave, mode, smoothing: 0.5, ...more }, l, r, 1, out)
    return { n, out }
  }

  it('lays a still wave out by its mode', () => {
    const line = wave(4, quiet, quiet, { y: 0.3 })
    expect(line.n).toBe(WAVE_POINTS)
    ;[0, 0.3, 1, 0.3].forEach((want, k) => expect(line.out[k < 2 ? k : 2 * WAVE_POINTS - 4 + k]).toBeCloseTo(want, 6))
    const circle = wave(0)
    expect(circle.n).toBe(WAVE_POINTS + 1)
    for (let i = 0; i < circle.n; i++) expect(Math.hypot(circle.out[2 * i] - 0.5, circle.out[2 * i + 1] - 0.5)).toBeCloseTo(0.25, 6)
    expect([circle.out[2 * WAVE_POINTS], circle.out[2 * WAVE_POINTS + 1]]).toEqual([circle.out[0], circle.out[1]])
  })

  it('puts the left side across and the right side up in the x-y scope', () => {
    const half = new Float32Array(512).fill(0.5)
    const { out } = wave(1, half, half)
    expect(out[100]).toBeCloseTo(0.725, 6)
    expect(out[101]).toBeCloseTo(0.275, 6)
  })

  it('smooths along the wave', () => {
    const rough = Float32Array.from({ length: 512 }, (_, i) => (i % 4 < 2 ? 1 : -1))
    const { out } = wave(4, rough, rough, { smoothing: 0.9 })
    for (let i = 20; i < WAVE_POINTS; i++) expect(Math.abs(out[2 * i + 1] - 0.5)).toBeLessThan(0.05)
  })
})

describe('preset music levels', () => {
  it('reads each range against its own last seconds', () => {
    const music = createMusic()
    const quiet = new Float32Array(61).fill(-60)
    for (let i = 0; i < 300; i++) music.push(quiet, quiet, 1 / 60)
    for (const level of Object.values(music.read())) expect(level).toBeCloseTo(1, 6)
    // The bass 20 dB louder for one frame: as high as it reads, the smoothed level only starting to follow.
    const kick = quiet.map((v, i) => (bandHz(i) < 250 ? -40 : v))
    music.push(kick, kick, 1 / 60)
    const now = music.read()
    expect(now.bass).toBe(5)
    expect(now.mid).toBeCloseTo(1, 6)
    expect(now.bassAtt).toBeGreaterThan(1.2)
    expect(now.bassAtt).toBeLessThan(1.5)
    music.silence()
    expect(music.read().bassAtt).toBe(0)
  })
})
