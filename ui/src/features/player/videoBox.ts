import { useEffect, useState } from 'react'
import { remoteArt } from '../../shared/art'
import type { Box } from '../../shared/artbox'
import { loadFit } from '../../shared/artfit'

// 16:9 frames of a video, biggest first: same geometry as the player, so their black bars are the video's own.
const frames = (id: string) => ['maxresdefault', 'hq720'].map((n) => remoteArt(`https://i.ytimg.com/vi/${id}/${n}.jpg`))

/** Picture inside a YouTube video's frame (bars baked into the video cut off). Null = unknown. */
export async function videoBox(id: string): Promise<Box | null> {
  for (const src of frames(id)) {
    try {
      const f = await loadFit(src)
      if (Math.abs(f.width / f.height - 16 / 9) < 0.02) return f.box
    } catch {
      // No such frame: next one.
    }
  }
  return null
}

export function useVideoBox(id: string | undefined): Box | null {
  const [state, setState] = useState<{ id?: string; box: Box | null }>({ box: null })
  useEffect(() => {
    if (!id) return
    let live = true
    void videoBox(id).then((box) => live && setState({ id, box }))
    return () => {
      live = false
    }
  }, [id])
  return id && state.id === id ? state.box : null
}
