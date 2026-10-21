import { describe, expect, it } from 'vitest'
import { move, press, release, shown, type Drag } from './seekDrag'

describe('seek bar drag', () => {
  it('keyboard change seeks at once and never pins the bar (the stuck bar bug)', () => {
    // Arrow key on the focused range: no pointer down before.
    const { drag, seek } = move(null, 90_000)
    expect(seek).toBe(90_000)
    expect(drag).toBeNull()
    // Next song: bar follows playback.
    expect(shown(drag, 'song-2', 1_500)).toBe(1_500)
  })

  it('a drag left open by a lost pointer release does not survive a song change', () => {
    let d: Drag = press('song-1', 10_000)
    d = move(d, 120_000).drag
    expect(shown(d, 'song-1', 10_500)).toBe(120_000)
    // Song ends under the pointer, release never arrives.
    expect(shown(d, 'song-2', 500)).toBe(500)
    // Late release: no seek into the new song.
    expect(release(d, 'song-2')).toEqual({ drag: null, seek: null })
  })

  it('drag then release seeks once, where the pointer left it', () => {
    let d: Drag = press('song-1', 0)
    for (const v of [5_000, 30_000, 61_000]) {
      const r = move(d, v)
      expect(r.seek).toBeNull()
      d = r.drag
    }
    expect(release(d, 'song-1')).toEqual({ drag: null, seek: 61_000 })
  })

  it('release with no drag does nothing', () => {
    expect(release(null, 'song-1')).toEqual({ drag: null, seek: null })
  })
})
