import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Mix } from '../../shared/api'

// Apart from the page: library pages need it at launch, the page loads on its first visit.

/** Today's mixes; reload after a pref change or reset. */
export function useMixes() {
  const [mixes, setMixes] = useState<Mix[]>()
  const reload = useCallback(
    () =>
      api
        .mixes()
        .then(setMixes)
        .catch((e) => useStore.setState({ error: String(e) })),
    [],
  )
  useEffect(() => void reload(), [reload])
  return { mixes, reload }
}
