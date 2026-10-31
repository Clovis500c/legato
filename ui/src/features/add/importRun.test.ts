import { describe, expect, it } from 'vitest'
import type { SpotifyProgress } from '../../shared/api'
import { advance, card, CARDS, newRun, secondsLeft, share, summary, timeLeft, type ImportRun } from './importRun'

const step = (over: Partial<SpotifyProgress> = {}): SpotifyProgress => ({ name: 'A list', list: 1, lists: 2, matching: true, done: 0, total: 10, allDone: 0, allTotal: 0, playable: 0, searched: 0, toSearch: 0, waiting: false, song: null, ...over })
const song = (title: string, playable = true) => ({ title, artist: 'A', cover: null, playable })

describe('the import screen', () => {
  it('keeps the last songs, each with its own number', () => {
    let run = newRun()
    for (let n = 0; n < CARDS + 3; n++) run = advance(run, step({ song: song(`s${n}`) }))
    expect(run.seen).toHaveLength(CARDS)
    expect(run.seen.at(-1)).toMatchObject({ title: `s${CARDS + 2}`, seq: CARDS + 2 })
    expect(run.seen[0].seq).toBe(3)
  })

  it('takes a step with no song without moving the deck', () => {
    const run = advance(advance(newRun(), step({ song: song('one') })), step({ done: 4 }))
    expect(run.seen).toHaveLength(1)
    expect(run.progress?.done).toBe(4)
  })

  it('measures all the songs when their number is known', () => {
    expect(share(step({ allDone: 50, allTotal: 200 }))).toBe(0.25)
    expect(share(step({ allDone: 300, allTotal: 200 }))).toBe(1)
    expect(share(undefined)).toBe(0)
  })

  it('measures by lists on Spotify’s page', () => {
    expect(share(step({ list: 2, lists: 4, done: 5, total: 10 }))).toBe(0.375)
    expect(share(step({ list: 3, lists: 4, total: 0 }))).toBe(0.5)
  })

  // 100 searches left to go at `gap` ms each, stopping after `searched`.
  const running = (searched: number, gap: number, over: Partial<SpotifyProgress> = {}) => {
    let run: ImportRun = newRun()
    for (let n = 1; n <= searched; n++) run = advance(run, step({ searched: n, toSearch: 100, ...over }), n * gap)
    return run
  }

  it('tells the time left from the pace of the searches', () => {
    expect(secondsLeft(running(20, 500))).toBeCloseTo((80 * 9.5) / 19)
  })

  it('says nothing too early', () => {
    expect(secondsLeft(running(5, 2000))).toBeUndefined()
    expect(secondsLeft(running(20, 10))).toBeUndefined()
    expect(secondsLeft(newRun())).toBeUndefined()
  })

  it('says nothing while YouTube makes it wait', () => {
    expect(secondsLeft(running(20, 500, { waiting: true }))).toBeUndefined()
  })

  it('has no time to tell on Spotify’s page, list by list', () => {
    let run = newRun()
    for (let n = 1; n < 30; n++) run = advance(run, step({ done: n }), n * 1000)
    expect(run.marks).toEqual([])
    expect(secondsLeft(run)).toBeUndefined()
  })

  it('follows the recent pace, not the start', () => {
    let run = running(20, 500)
    for (let n = 21; n <= 40; n++) run = advance(run, step({ searched: n, toSearch: 100 }), 10_000 + (n - 20) * 5000)
    const left = secondsLeft(run)
    expect(left).toBeGreaterThan(55 * 4)
    expect(left).toBeLessThan(60 * 6)
  })

  it('counts a pause in the pace', () => {
    let run = running(20, 500)
    run = advance(run, step({ searched: 21, toSearch: 100 }), 40_000)
    expect(secondsLeft(run)).toBeGreaterThan(100)
  })

  it('reads the time left in minutes, rounded up', () => {
    expect(timeLeft(30)).toBe('Less than a minute left')
    expect(timeLeft(60)).toBe('About 1 min left')
    expect(timeLeft(61)).toBe('About 2 min left')
    expect(timeLeft(600)).toBe('About 10 min left')
  })

  it('ends a search again without speaking of lists', () => {
    expect(summary({ playlistId: null, lists: 0, songs: 12, playable: 5, failed: [], unsearched: 0 })).toBe('5 of 12 songs found on YouTube')
  })

  it('ends by saying what YouTube left unsearched', () => {
    const end = { playlistId: 1, lists: 2, songs: 10, playable: 6, failed: [], unsearched: 0 }
    expect(summary(end)).not.toContain('YouTube')
    expect(summary({ ...end, unsearched: 3 })).toContain('3 songs left')
  })

  it('fans the older cards out, the newest flat on top', () => {
    expect(card({ ...song('new'), seq: 8 }, 8)).toMatchObject({ transform: 'translateX(0px) rotate(0deg) scale(1)', opacity: 1, zIndex: CARDS })
    const left = card({ ...song('old'), seq: 6 }, 8)
    const right = card({ ...song('old'), seq: 5 }, 8)
    expect(left.transform).toContain('translateX(-96px)')
    expect(right.transform).toContain('translateX(144px)')
    expect(Number(left.zIndex)).toBeLessThan(CARDS)
  })

  it('fades a song with no YouTube version', () => {
    expect(card({ ...song('lost', false), seq: 2 }, 2).opacity).toBeLessThan(0.5)
  })
})
