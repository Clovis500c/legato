// Videos the player found unplayable for good (removed, private, blocked in the country: YouTube's own words), for the
// library health page. This PC's only, like the embed's refusals (`player/store.ts` blocked).
const KEY = 'legato-broken-videos'
const MAX = 1000

export interface BrokenVideo {
  video: string
  /** YouTube's reason, as the watch page said it. */
  why: string
  at: number
}

export function brokenVideos(): BrokenVideo[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((b): b is BrokenVideo => typeof b?.video === 'string' && typeof b.why === 'string') : []
  } catch {
    return []
  }
}

function keep(list: BrokenVideo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    // Storage off: the page just won't list it.
  }
}

export function markBroken(video: string, why: string) {
  keep([...brokenVideos().filter((b) => b.video !== video), { video, why: why.slice(0, 200), at: Date.now() }])
}

/** Looked at again (another version picked, or the user says it plays now). */
export function forgetBroken(videos: string[]) {
  const gone = new Set(videos)
  keep(brokenVideos().filter((b) => !gone.has(b.video)))
}
