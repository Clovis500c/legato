import { create } from 'zustand'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { songKey } from './effects'
import { usePlayer } from './store'

/**
 * A–B loop for practising: from the player's menu, the moment now becomes the loop's start (A) or end (B); at B the song
 * goes back to A, until the loop is cleared or another song starts. Done from the position the player reports (a quarter
 * of a second late for a file, so B is reached a moment after it), no change to the engine.
 */
export const useLoop = create<{ song: string | null; a: number | null; b: number | null }>(() => ({ song: null, a: null, b: null }))

/** Shortest loop, ms: a click twice is no loop. */
const MIN = 1000

/** Where to jump back to when the position has reached the loop's end, else null. */
export const loopBack = (pos: number, a: number | null, b: number | null): number | null => (a !== null && b !== null && b - a >= MIN && pos >= b ? a : null)

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/** The loop's start (`end` false) or end (`end` true) at the moment now. */
export function markLoop(end: boolean) {
  const { now, positionMs } = usePlayer.getState()
  const song = songKey(now)
  if (!song) return
  const cur = useLoop.getState()
  // Another song's loop is gone.
  const [a, b] = cur.song === song ? [cur.a, cur.b] : [null, null]
  const ms = Math.round(positionMs)
  const next = end ? { a, b: ms } : { a: ms, b }
  if (next.a !== null && next.b !== null && next.b - next.a < MIN) return void useStore.getState().notify(tr('The loop’s end must come after its start.'), { kind: 'error' })
  useLoop.setState({ song, ...next })
  if (next.a !== null && next.b !== null) useStore.getState().notify(tr('Looping {a} to {b}', { a: clock(next.a), b: clock(next.b) }))
}

/** What one press of the loop key does: the first sets the start, the second the end, the third clears. */
export const loopPress = (a: number | null, b: number | null): 'start' | 'end' | 'clear' => (a === null ? 'start' : b === null ? 'end' : 'clear')

export function cycleLoop() {
  const { now } = usePlayer.getState()
  const { song, a, b } = useLoop.getState()
  // Another song's loop is none.
  const step = loopPress(song === songKey(now) ? a : null, song === songKey(now) ? b : null)
  if (step === 'clear') clearLoop()
  else markLoop(step === 'end')
}

export const clearLoop = () => useLoop.setState({ song: null, a: null, b: null })

/** Follows the player: the loop turns the song back at its end, and goes when the song changes. Returns cleanup. */
export function startLoop(): () => void {
  return usePlayer.subscribe((s) => {
    const loop = useLoop.getState()
    if (loop.song === null) return
    if (songKey(s.now) !== loop.song) return clearLoop()
    const back = loopBack(s.positionMs, loop.a, loop.b)
    if (back !== null) s.seek(back)
  })
}
