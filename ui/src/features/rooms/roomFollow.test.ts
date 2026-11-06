import { describe, expect, it } from 'vitest'
import type { RoomNow, RoomSong } from '../../shared/api'
import { catchUp, DRIFT_MS, follow, positionAt, SETTLE_MS, shouldSeek, songKey, START, type Follow } from './roomFollow'

const song = (title: string, youtube: string | null = 'dQw4w9WgXcQ'): RoomSong => ({ title, artist: 'Band', album: null, durationMs: 200_000, isrc: null, youtube, spotify: null, art: null })
const room = (over: Partial<RoomNow> = {}): RoomNow => ({ song: song('A'), positionMs: 10_000, playing: true, at: 0, seq: 1, ...over })

/** Loaded and playing at the room's place: a settled follower at `t`. */
function settled(r: RoomNow, t: number): Follow {
  const [f] = follow(START, r, { key: null, positionMs: 0, playing: false }, t - SETTLE_MS - 1)
  return f
}

describe('roomFollow', () => {
  it('keys songs by their best id', () => {
    expect(songKey(song('A'))).toBe('yt:dQw4w9WgXcQ')
    expect(songKey({ ...song('A', null), spotify: '4uLU6hMCjMI75M1A2tKUQC' })).toBe('sp:4uLU6hMCjMI75M1A2tKUQC')
    expect(songKey({ ...song('A', null), isrc: 'USRC17607839' })).toBe('isrc:USRC17607839')
    expect(songKey(song('Song', null))).toBe(songKey({ ...song('SONG', null), artist: 'BAND' }))
    expect(songKey(null)).toBeNull()
  })

  it('moves the position while playing, as the Rust twin', () => {
    expect(positionAt(room({ at: 1000 }), 3500)).toBe(12_500)
    expect(positionAt(room({ at: 1000 }), 500)).toBe(10_000)
    expect(positionAt(room({ at: 0 }), 10_000_000)).toBe(200_000)
    expect(positionAt(room({ playing: false, at: 1000 }), 3500)).toBe(10_000)
  })

  it('seeks past the drift threshold only, then waits', () => {
    expect(shouldSeek(10_000, 10_000 - DRIFT_MS, 0, 0)).toBe(false)
    expect(shouldSeek(10_000, 8_000, 0, 0)).toBe(true)
    expect(shouldSeek(8_000, 10_000, 0, 0)).toBe(true)
    expect(shouldSeek(10_000, 0, 100, 100 + SETTLE_MS)).toBe(false)
  })

  it('loads a new song at once, where the room is', () => {
    const [f, step] = follow(START, room({ at: 1000 }), { key: null, positionMs: 0, playing: false }, 3000)
    expect(step).toEqual({ kind: 'load', song: song('A'), atMs: 12_000, play: true })
    expect(f.song).toBe('yt:dQw4w9WgXcQ')
    expect(f.quietUntil).toBe(3000 + SETTLE_MS)
    // Still loading: nothing more.
    expect(follow(f, room({ at: 1000 }), { key: null, positionMs: 0, playing: false }, 3500)[1]).toBeNull()
  })

  it('follows play and pause at once, without a seek loop', () => {
    const r = room()
    const t = 50_000
    const f = settled(r, t)
    const at = positionAt(r, t)
    expect(follow(f, r, { key: f.song, positionMs: at - 500, playing: true }, t)[1]).toBeNull()
    const [f2, seek] = follow(f, r, { key: f.song, positionMs: at - 3000, playing: true }, t)
    expect(seek).toEqual({ kind: 'seek', ms: at })
    // Right after: still off (the player catching up), left alone.
    expect(follow(f2, r, { key: f.song, positionMs: at - 3000, playing: true }, t + 1000)[1]).toBeNull()
    const paused = room({ playing: false, positionMs: at, at: t })
    const [f3, pause] = follow(f2, paused, { key: f.song, positionMs: at, playing: true }, t + 1000)
    expect(pause).toEqual({ kind: 'pause' })
    const [, play] = follow(f3, room({ positionMs: at, at: t + 2000 }), { key: f.song, positionMs: at, playing: false }, t + 2000)
    expect(play).toEqual({ kind: 'play' })
  })

  it('seeks at once when the host seeked', () => {
    const r = room()
    const t = 50_000
    const f = settled(r, t)
    const [, step] = follow(f, room({ seq: 2, positionMs: 90_000, at: t }), { key: f.song, positionMs: positionAt(r, t), playing: true }, t)
    expect(step).toEqual({ kind: 'seek', ms: 90_000 })
  })

  it('lets a listener pause on their own until Catch up', () => {
    const r = room()
    const t = 50_000
    const f = settled(r, t)
    const [own, step] = follow(f, r, { key: f.song, positionMs: 20_000, playing: false }, t)
    expect(step).toBeNull()
    expect(own.own).toBe(true)
    // The room goes on: no play, no seek.
    expect(follow(own, room({ seq: 5 }), { key: f.song, positionMs: 20_000, playing: false }, t + 9000)[1]).toBeNull()
    // A new song loads paused.
    const [, load] = follow(own, room({ song: song('B', 'aaaaaaaaaaa') }), { key: f.song, positionMs: 20_000, playing: false }, t + 9000)
    expect(load).toMatchObject({ kind: 'load', play: false })
    // Catch up: play, then the room's place as soon as it plays (not after the quiet time).
    const back = catchUp(own)
    const [b2, play] = follow(back, r, { key: f.song, positionMs: 20_000, playing: false }, t + 10_000)
    expect(play).toEqual({ kind: 'play' })
    const [b3, seek] = follow(b2, r, { key: f.song, positionMs: 20_000, playing: true }, t + 11_000)
    expect(seek).toEqual({ kind: 'seek', ms: positionAt(r, t + 11_000) })
    expect(follow(b3, r, { key: f.song, positionMs: 20_000, playing: true }, t + 12_000)[1]).toBeNull()
  })

  it('waits for the host when its song ends here first', () => {
    const r = room()
    const t = 50_000
    const f = settled(r, t)
    // Another version, a few seconds shorter: over here, the room still plays.
    const [f2, step] = follow(f, r, { key: f.song, positionMs: 195_000, playing: false, ended: true }, t + 9000)
    expect(step).toBeNull()
    expect(f2.own).toBe(false)
    const [, load] = follow(f2, room({ song: song('B', 'bbbbbbbbbbb'), seq: 2, positionMs: 0, at: t + 10_000 }), { key: f.song, positionMs: 195_000, playing: false, ended: true }, t + 10_000)
    expect(load).toMatchObject({ kind: 'load', play: true })
  })

  it('never seeks back at the room song’s end', () => {
    const r = room({ positionMs: 199_000, at: 0 })
    const t = 60_000
    const f = settled(r, t)
    // The room's place stopped at 200 s (the host's length); this version plays on.
    expect(follow(f, r, { key: f.song, positionMs: 205_000, playing: true }, t)[1]).toBeNull()
  })

  it('lands a host’s seek made while paused', () => {
    const t = 50_000
    const f = settled(room(), t)
    const [f2, pause] = follow(f, room({ playing: false, seq: 2, positionMs: 90_000, at: t }), { key: f.song, positionMs: 50_000, playing: true }, t)
    expect(pause).toEqual({ kind: 'pause' })
    const [, seek] = follow(f2, room({ playing: false, seq: 2, positionMs: 90_000, at: t }), { key: f.song, positionMs: 50_000, playing: false }, t + 1000)
    expect(seek).toEqual({ kind: 'seek', ms: 90_000 })
  })

  it('does nothing for a song not found here, until the next one', () => {
    const r = room()
    const f = { ...settled(r, 50_000), missing: true }
    expect(follow(f, r, { key: null, positionMs: 0, playing: false }, 50_000)[1]).toBeNull()
    const [, load] = follow(f, room({ song: song('B', 'bbbbbbbbbbb') }), { key: null, positionMs: 0, playing: false }, 50_000)
    expect(load?.kind).toBe('load')
  })

  it('pauses when the room plays nothing', () => {
    const f = settled(room(), 50_000)
    expect(follow(f, room({ song: null }), { key: f.song, positionMs: 0, playing: true }, 50_000)[1]).toEqual({ kind: 'pause' })
  })
})
