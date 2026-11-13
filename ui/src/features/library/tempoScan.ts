const FIRST = 120_000
const BUSY = 15_000
const IDLE = 30 * 60_000

/**
 * Estimated tempo (Settings › Playback › Estimate tempo, off by default): while on, three local songs without a tempo
 * every 15 seconds (the work is Rust's, off this thread), then a look every half hour. The first one waits two minutes
 * after launch. Returns cleanup.
 */
export function startTempoScan(on: () => boolean, scan: (limit: number) => Promise<number>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const run = async () => {
    let next = IDLE
    if (on()) next = await scan(3).then((left) => (left > 0 ? BUSY : IDLE), () => IDLE)
    if (!stopped) timer = setTimeout(() => void run(), next)
  }
  timer = setTimeout(() => void run(), FIRST)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
