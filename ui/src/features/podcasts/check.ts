import { useStore } from '../../app/store'
import { api, type PodcastFeed } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { fresh, load } from './played'

const KEY = 'legato.podcastsChecked'
/** Between two rounds (the app open): a round asks each kept show's feed once. */
export const EVERY_MS = 6 * 3_600_000
/** Between two feeds of a round, so no host sees a burst. */
const GAP_MS = 1_500
/** At most this many shows a round. */
const MAX_SHOWS = 30

export const due = (last: number, now: number) => !(last > 0) || now - last >= EVERY_MS || now < last

/** Episodes of this feed the Podcasts page has not shown yet (none for a show never opened: everything would be new). */
export const newIn = (feed: PodcastFeed): number => fresh(load(), feed.url, feed.episodes.map((e) => e.id)).length

const lastRound = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

/**
 * Podcasts › new episodes on their own (Settings › General › Check podcasts, off by default): while the app is open, every
 * 6 hours each kept show's feed is read once (the feed address the user typed, nothing else), and a notice counts the
 * new episodes. Nothing is marked seen: the page still says which are new. Returns cleanup.
 */
export function startPodcastCheck(on: () => boolean): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const round = async () => {
    if (!on() || !due(lastRound(), Date.now())) return
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      // Not kept: the next launch asks again.
    }
    const shows = (await api.podcastKept().catch(() => [])).slice(0, MAX_SHOWS)
    let fresh = 0
    for (const s of shows) {
      if (stopped || !on()) return
      fresh += await api.podcastFeed(s.url).then(newIn, () => 0)
      await new Promise((r) => setTimeout(r, GAP_MS))
    }
    if (fresh > 0) useStore.getState().notify(trn(fresh, '{n} new podcast episode', '{n} new podcast episodes'), { action: { label: tr('Podcasts'), run: () => useStore.getState().go({ name: 'podcasts' }) } })
  }
  const tick = () => {
    void round().finally(() => {
      if (!stopped) timer = setTimeout(tick, 30 * 60_000)
    })
  }
  // A minute after launch, so the first screen is not competing.
  timer = setTimeout(tick, 60_000)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
