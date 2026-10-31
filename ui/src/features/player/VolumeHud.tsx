import { useEffect, useState } from 'react'
import { usePlayer } from './store'
import { useVolumeHud } from './volume'

/** A small number over the player while the volume changes (wheel, keys), gone after a moment. */
export function VolumeHud() {
  const at = useVolumeHud((s) => s.at)
  const volume = usePlayer((s) => s.volume)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!at) return
    setOn(true)
    const id = setTimeout(() => setOn(false), 900)
    return () => clearTimeout(id)
  }, [at])
  if (!on) return null
  return (
    <div role="status" className="pointer-events-none fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-raised px-4 py-1.5 text-sm font-semibold text-ink tabular-nums shadow-[0_8px_24px_var(--shadow)]">
      {Math.round(volume * 100)} %
    </div>
  )
}
