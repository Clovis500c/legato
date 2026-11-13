import { expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { parseMinutes, sessionSongs } from './focusMix'

const song = (id: number, extra: Partial<LibraryTrack> = {}) => ({ id, title: `S${id}`, artist: 'A', durationMs: 200_000, ids: {}, ...extra }) as LibraryTrack
const ids = (l: LibraryTrack[]) => l.map((t) => t.id).sort((a, b) => a - b)
const first = () => 0

it('takes 5 to 240 minutes and nothing else', () => {
  expect(['25', ' 90 ', '5', '240', '4', '241', 'x', ''].map(parseMinutes)).toEqual([25, 90, 5, 240, null, null, null, null])
})

it('a focus session is the songs you have played, not the long ones nor explicit ones when hidden', () => {
  const tracks = [...Array.from({ length: 10 }, (_, i) => song(i + 1)), song(11, { durationMs: 3_600_000 }), song(12, { explicit: true }), song(13)]
  const stats = Object.fromEntries([...Array.from({ length: 12 }, (_, i) => [i + 1, [3 + i, 0]])]) as Record<number, [number, number]>
  expect(ids(sessionSongs('focus', tracks, stats, true, first))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(ids(sessionSongs('focus', tracks, stats, false, first))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12])
  // Never played (13) stays out.
  expect(ids(sessionSongs('focus', tracks, stats, false, first))).not.toContain(13)
})

it('a workout is the tagged 120 BPM and up, and a handful of songs makes no session', () => {
  const tracks = [...Array.from({ length: 9 }, (_, i) => song(i + 1, { bpm: 120 + i })), song(20, { bpm: 90 }), song(21)]
  expect(ids(sessionSongs('workout', tracks, {}, false, first))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(sessionSongs('workout', tracks.slice(0, 5), {}, false, first)).toEqual([])
  expect(sessionSongs('focus', [song(1)], { 1: [9, 0] }, false, first)).toEqual([])
})
