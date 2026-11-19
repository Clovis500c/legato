import { describe, expect, it } from 'vitest'
import { keyAction, mediaNow, missingThumbs, needsPush, phoneButton, phoneCover, phoneMessage, phoneQueue } from './media'

describe('phone cover', () => {
  it('takes the first cover the art scheme serves, as its 256 px thumbnail', async () => {
    const asked: string[] = []
    const load = async (src: string) => {
      asked.push(src)
      return src.includes('local%2F') ? null : '/9j/AA=='
    }
    const local = 'http://art.localhost/local%2F7'
    const remote = 'http://art.localhost/https%3A%2F%2Fi.ytimg.com%2Fvi%2Fx%2Fhqdefault.jpg'
    expect(await phoneCover([local, remote], load)).toBe('/9j/AA==')
    expect(asked).toEqual([`${local}?s=256`, `${remote}?s=256`])
    expect(await phoneCover([], load)).toBe('')
  })

  it('a bigger one for the disc widget (600 px), a smaller for the rows', async () => {
    const asked: string[] = []
    const load = async (src: string) => (asked.push(src), 'AA==')
    const remote = 'http://art.localhost/https%3A%2F%2Fi.ytimg.com%2Fvi%2Fx%2Fhqdefault.jpg'
    await phoneCover([remote], load, 600)
    await phoneCover([remote], load, 128)
    expect(asked).toEqual([`${remote}?s=600`, `${remote}?s=256`])
  })
})

describe('media keys', () => {
  it('play and pause only act when they change state', () => {
    expect(keyAction('play', false)).toBe('toggle')
    expect(keyAction('play', true)).toBeNull()
    expect(keyAction('pause', true)).toBe('toggle')
    expect(keyAction('pause', false)).toBeNull()
    expect(keyAction('like', false)).toBe('like')
    expect(keyAction('stop', true)).toBe('toggle')
  })

  it('next, previous and the tray toggle always act', () => {
    expect(keyAction('next', false)).toBe('next')
    expect(keyAction('previous', true)).toBe('prev')
    expect(keyAction('toggle', true)).toBe('toggle')
    expect(keyAction('toggle', false)).toBe('toggle')
  })
})

const now = { title: 'Blinding Lights', artist: 'The Weeknd', via: 'youtube' as const, trackId: 1 }

describe('media panel info', () => {
  it('nothing playing hides the panel', () => {
    expect(mediaNow(undefined, false)).toBeNull()
  })

  it('takes album from the library row, rounds times', () => {
    const track = { id: 1, added: 1, addedAt: null, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', durationMs: null, isrc: null, ids: {} }
    expect(mediaNow(now, true, track, 1234.6, 200_000.4)).toEqual({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', playing: true, positionMs: 1235, durationMs: 200_000 })
    expect(mediaNow(now, false)?.album).toBeNull()
    expect(mediaNow(now, false, undefined, -50)?.positionMs).toBe(0)
  })
})

describe('when to push', () => {
  const at = (playing: boolean, positionMs: number) => mediaNow(now, playing, undefined, positionMs, 200_000)

  it('pushes changes of track, state or duration', () => {
    expect(needsPush(null, at(true, 0), 0)).toBe(true)
    expect(needsPush({ info: null, at: 0 }, null, 0)).toBe(false)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(false, 500), 500)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, { ...at(true, 500)!, durationMs: 210_000 }, 500)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, null, 500)).toBe(true)
  })

  it('normal playback is left to Windows, seeks and drift are not', () => {
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 3000), 3000)).toBe(false)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 60_000), 3000)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 11_000), 11_000)).toBe(true)
    // Paused: position must stay put.
    expect(needsPush({ info: at(false, 5000), at: 0 }, at(false, 5000), 60_000)).toBe(false)
    expect(needsPush({ info: at(false, 5000), at: 0 }, at(false, 9000), 1000)).toBe(true)
  })

  it('the phone gets what plays as JSON and takes buttons back', () => {
    expect(phoneMessage(null)).toBe('{}')
    expect(JSON.parse(phoneMessage(at(true, 1200)!))).toMatchObject({ playing: true, positionMs: 1200 })
    expect(phoneButton('next')).toEqual({ key: 'next' })
    expect(phoneButton('seek:42000')).toEqual({ seek: 42000 })
    expect(phoneButton('seek:x')).toBeNull()
    expect(phoneButton('play:7')).toEqual({ play: 7 })
    expect(phoneButton('play:-1')).toBeNull()
    expect(phoneButton('play:x')).toBeNull()
    expect(phoneButton('format')).toBeNull()
  })
})

describe('the queue sent to the phone widget', () => {
  const list = ['a', 'b', 'c', 'd'].map((t, n) => ({ id: 100 + n, title: t, artist: `${t}!` }))
  it('starts at the current song and follows the play order', () => {
    expect(JSON.parse(phoneQueue(list, [2, 0, 3, 1], 0))).toEqual({ queue: [{ i: 0, t: 'a', a: 'a!', k: 100 }, { i: 3, t: 'd', a: 'd!', k: 103 }, { i: 1, t: 'b', a: 'b!', k: 101 }] })
  })
  it('is cut to its size and skips what is gone', () => {
    expect(JSON.parse(phoneQueue(list, [0, 1, 2, 3], 0, 2)).queue).toHaveLength(2)
    expect(JSON.parse(phoneQueue(list, [0, 9, 1], 0)).queue.map((r: { i: number }) => r.i)).toEqual([0, 1])
    expect(JSON.parse(phoneQueue([], [], -1))).toEqual({ queue: [] })
  })
  it('asks the covers of the first rows only, once per song, never what is gone', () => {
    const many = Array.from({ length: 30 }, (_, n) => ({ id: n + 1, title: `t${n}`, artist: 'x' }))
    const order = many.map((_, n) => n)
    expect(missingThumbs(many, order, 0, new Set()).map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(missingThumbs(many, order, 0, new Set([1, 2, 3])).map((t) => t.id)).toEqual([4, 5, 6, 7, 8, 9, 10])
    // The queue moved on a song: the song that left is not asked, the new tenth is.
    expect(missingThumbs(many, order, 1, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).map((t) => t.id)).toEqual([11])
    expect(missingThumbs(many, [0, 99, 1], 0, new Set()).map((t) => t.id)).toEqual([1, 2])
    expect(missingThumbs([], [], -1, new Set())).toEqual([])
  })
})
