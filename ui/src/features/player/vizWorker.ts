import type { ToWorker } from './vizProtocol'
import { createPainter } from './vizPaint'

/**
 * The visualizer's worker (VizCanvas.tsx): owns the canvas, draws from the frames it is sent. The animation loop runs
 * only while something moves: it stops itself at rest and `run: false` stops it for good (hidden page, off screen).
 */
type Painter = ReturnType<typeof createPainter>
const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; requestAnimationFrame?: (f: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void }

let painter: Painter | null = null
let running = true
let id = 0
let last = 0

const schedule = (f: (t: number) => void) => (scope.requestAnimationFrame ? scope.requestAnimationFrame(f) : (setTimeout(() => f(performance.now()), 16) as unknown as number))
const cancel = (n: number) => (scope.cancelAnimationFrame ? scope.cancelAnimationFrame(n) : clearTimeout(n))

function tick(now: number) {
  id = 0
  if (!running || !painter) return
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
  last = now
  if (!painter.draw(dt)) id = schedule(tick)
}

/** Starts the loop if it is not running. */
function wake() {
  if (id || !running || !painter) return
  last = performance.now()
  id = schedule(tick)
}

scope.onmessage = (e) => {
  const m = e.data
  switch (m.t) {
    case 'init':
      painter = createPainter(m.canvas)
      break
    case 'size':
      painter?.size(m.w, m.h, m.dpr)
      wake()
      break
    case 'look':
      painter?.set(m.look, m.calm, m.ink, m.warn)
      wake()
      break
    case 'frame':
      painter?.frame(m.l, m.r)
      wake()
      break
    case 'silence':
      painter?.silence()
      wake()
      break
    case 'run':
      running = m.on
      if (running) wake()
      else if (id) {
        cancel(id)
        id = 0
      }
      break
  }
}
