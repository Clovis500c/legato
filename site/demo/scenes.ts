import { useStore } from '../../ui/src/app/store'
import { advance, newRun, type ImportRun } from '../../ui/src/features/add/importRun'
import { TRACKS } from './data'

// The website picks what shows: { legato: 'scene', name, p } from the parent page, p = how far the visitor scrolled in it.

const LISTS = ['Liked Songs', 'Sunday Morning', 'Late Drive', 'Train to Work']
// Every 7th song: a new album each time, not six times the same cover.
const SONGS = TRACKS.map((_, i) => TRACKS[(i * 7) % TRACKS.length])
const ALL_SONGS = 1240

/** The import as it would go, song after song: a scroll backwards is the same list read backwards. */
function runs(): ImportRun[] {
  const start = Date.now()
  const all = [newRun()]
  SONGS.forEach((t, i) => {
    const allDone = Math.round(((i + 1) / SONGS.length) * ALL_SONGS)
    const list = Math.min(LISTS.length, 1 + Math.floor((i / SONGS.length) * LISTS.length))
    const song = { title: t.title, artist: t.artist, cover: t.art ?? null, playable: i % 11 !== 7 }
    all.push(advance(all[i], { name: LISTS[list - 1], list, lists: LISTS.length, matching: true, done: allDone, total: ALL_SONGS, allDone, allTotal: ALL_SONGS, playable: Math.round(allDone * 0.96), searched: allDone, toSearch: ALL_SONGS, waitSecs: 0, song }, start + i * 1500))
  })
  return all
}

let script: ImportRun[] = []

const SCENES: Record<string, (p: number) => void> = {
  library() {
    const { view, go } = useStore.getState()
    useStore.setState({ importRun: undefined })
    if (view.name !== 'songs') go({ name: 'songs' })
  },
  import(p) {
    if (!script.length) script = runs()
    useStore.setState({ importRun: { ...script[Math.round(p * (script.length - 1))], hidden: false } })
  },
}

window.addEventListener('message', (e: MessageEvent<{ legato?: string; name: string; p: number }>) => {
  if (e.origin === location.origin && e.data.legato === 'scene') SCENES[e.data.name]?.(e.data.p)
})

// Library in: the first screen is there.
const up = () => requestAnimationFrame(() => window.parent.postMessage({ legato: 'ready' }, location.origin))
if (useStore.getState().tracks.length) up()
else {
  const off = useStore.subscribe((s) => {
    if (!s.tracks.length) return
    off()
    up()
  })
}
