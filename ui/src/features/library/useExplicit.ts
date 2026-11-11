import { useMemo } from 'react'
import { useSettings } from '../../app/settings'
import type { LibraryTrack } from '../../shared/api'
import { splitExplicit } from './filter'

/** Settings › Hide explicit songs: the list without them, and the ones set aside (for `HiddenExplicit`). */
export function useExplicit(tracks: LibraryTrack[]) {
  const hide = useSettings((s) => s.settings.hideExplicit)
  return useMemo(() => splitExplicit(tracks, hide), [tracks, hide])
}
