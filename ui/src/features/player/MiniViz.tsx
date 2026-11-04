import { lazy, Suspense } from 'react'
import { useSettings } from '../../app/settings'
import { usePlayer } from './store'

// The canvas and its worker come with Now Playing's chunk, loaded by the first mini visualizer shown: never at start-up.
const Strip = lazy(() => import('./Visualizer').then((m) => ({ default: m.MiniStrip })))

/**
 * A thin visualizer in the mini player, floating, in the right panel or in the sidebar (Settings › Playback ›
 * Visualizer in the mini player, off by default). Clicks go through to the player.
 */
export function MiniViz({ className = '' }: { className?: string }) {
  const on = useSettings((s) => s.settings.visualizer && s.settings.visualizerMini && s.settings.motion)
  const spotify = usePlayer((s) => s.now?.via === 'spotify')
  if (!on || spotify) return null
  return (
    <div aria-hidden className={`pointer-events-none h-6 ${className}`}>
      <Suspense>
        <Strip />
      </Suspense>
    </div>
  )
}
