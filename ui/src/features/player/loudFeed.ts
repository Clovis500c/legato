import { create } from 'zustand'
import { useLive } from './live'
import { usePlayer } from './store'
import { createLoudness, type LoudReading } from './vizLoud'

/**
 * The loudness meter's feed (the Loudness meter look, vizLoud.ts): one count per song, whichever view shows it, fed by
 * the live levels while a view listens (liveSync.ts asks for them then) and counted while the song plays. A new song
 * starts it over.
 */
export const useLoudListeners = create<{ n: number }>(() => ({ n: 0 }))

const meter = createLoudness()
const subs = new Set<(r: LoudReading) => void>()
let song: string | null = null
let stop: (() => void) | null = null

const songOf = () => {
  const now = usePlayer.getState().now
  return now ? String(now.trackId ?? now.youtubeId ?? now.path ?? now.title) : ''
}

const tell = () => {
  const r = meter.reading()
  subs.forEach((f) => f(r))
}

/** The song changed since the last count: from nothing. */
function follow() {
  const key = songOf()
  if (key === song) return false
  song = key
  meter.reset()
  return true
}

function start() {
  let last = performance.now()
  const offLevels = useLive.subscribe((s, prev) => {
    if (!s.levels || s.levels === prev.levels) return
    follow()
    const t = performance.now()
    meter.push(s.levels, usePlayer.getState().playing ? t - last : 0)
    last = t
    tell()
  })
  const offSong = usePlayer.subscribe(() => follow() && tell())
  return () => {
    offLevels()
    offSong()
  }
}

/** The meter's numbers to `fn`, now and with each update. Returns the unsubscribe. The first view starts the feed, the last stops it. */
export function subscribeLoud(fn: (r: LoudReading) => void): () => void {
  subs.add(fn)
  useLoudListeners.setState({ n: subs.size })
  if (subs.size === 1) stop = start()
  follow()
  fn(meter.reading())
  return () => {
    if (!subs.delete(fn)) return
    useLoudListeners.setState({ n: subs.size })
    if (subs.size === 0) {
      stop?.()
      stop = null
    }
  }
}
