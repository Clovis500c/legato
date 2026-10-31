import { useSettings } from '../../ui/src/app/settings'
import { useStore } from '../../ui/src/app/store'
import { advance, newRun, type ImportRun } from '../../ui/src/features/add/importRun'
import { useEditor } from '../../ui/src/features/editor/editor'
import { NEUTRAL } from '../../ui/src/features/player/effects'
import { closeKaraoke, openKaraoke, useKaraoke } from '../../ui/src/features/player/karaokeMode'
import { usePlayer } from '../../ui/src/features/player/store'
import { closeVizFull, openVizFull, useVizFull } from '../../ui/src/features/player/vizFull'
import type { LibraryTrack } from '../../ui/src/shared/api'
import { TRACKS } from './data'

// The website picks what shows: { legato: 'scene', name, p } from the parent page, p = how far the visitor scrolled in it.

type Scene = { enter?: () => void; move?: (p: number) => void; leave?: () => void }

const LISTS = ['Liked Songs', 'Sunday Morning', 'Late Drive', 'Train to Work']
// Every 7th song: a new album each time, not six times the same cover.
const SONGS = TRACKS.map((_, i) => TRACKS[(i * 7) % TRACKS.length])
const ALL_SONGS = 1240
const WORD = 'harbour'
const LOOKS = ['led', 'radial', 'vu', 'spectrogram'] as const
const THEMES = ['system', 'paper', 'graphite', 'sage'] as const

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
let searched = false

const songs = () => {
  const { view, go } = useStore.getState()
  if (view.name !== 'songs') go({ name: 'songs' })
}
const play = (on: boolean) => {
  const p = usePlayer.getState()
  if (p.playing !== on) p.toggle()
}
const set = (patch: Parameters<ReturnType<typeof useSettings.getState>['update']>[0]) => useSettings.getState().update(patch)

const SCENES: Record<string, Scene> = {
  library: { enter: songs },
  import: {
    enter: songs,
    move(p) {
      if (!script.length) script = runs()
      useStore.setState({ importRun: { ...script[Math.round(p * (script.length - 1))], hidden: false } })
    },
    leave: () => useStore.setState({ importRun: undefined }),
  },
  search: {
    enter: songs,
    // The word typed in the top bar, then the page it finds.
    move(p) {
      const typed = p >= 0.45
      if (typed && !searched) useStore.getState().searchFor(WORD)
      if (!typed) {
        if (searched) songs()
        useStore.setState({ query: WORD.slice(0, Math.ceil((p / 0.45) * WORD.length)) })
      }
      searched = typed
    },
    leave() {
      searched = false
      useStore.setState({ query: '' })
      songs()
    },
  },
  player: {
    enter() {
      songs()
      play(true)
    },
  },
  karaoke: {
    enter() {
      openKaraoke()
      play(true)
    },
    leave: closeKaraoke,
  },
  visualizer: {
    // The page turns black for this one: the app with it.
    enter() {
      set({ theme: 'modern-dark' })
      play(true)
      openVizFull()
    },
    move(p) {
      const look = LOOKS[Math.min(LOOKS.length - 1, Math.floor(p * LOOKS.length))]
      if (useSettings.getState().settings.visualizerStyle !== look) set({ visualizerStyle: look })
    },
    leave() {
      closeVizFull()
      set({ visualizerStyle: 'led', theme: THEMES[0] })
    },
  },
  editor: {
    enter() {
      set({ editor: true, upNext: false, lyrics: false })
      usePlayer.getState().setFull(true)
    },
    move(p) {
      useEditor.setState({ dirty: p > 0, effects: { ...NEUTRAL, speed: 1 - 0.15 * p, pitch: -3 * p, bass: 8 * p, eq: NEUTRAL.eq.map((_, i) => Math.round(7 * p * Math.sin(i * 0.7 + 1))) } })
    },
    leave() {
      useEditor.setState({ dirty: false, effects: NEUTRAL })
      usePlayer.getState().setFull(false)
      set({ editor: false })
    },
  },
  themes: {
    enter: songs,
    move(p) {
      const theme = THEMES[Math.min(THEMES.length - 1, Math.floor(p * THEMES.length))]
      if (useSettings.getState().settings.theme !== theme) set({ theme })
    },
    leave: () => set({ theme: THEMES[0] }),
  },
  // The page moved on: nothing runs for nobody.
  rest: { enter: () => play(false) },
}

let shown: string | undefined
let taken = false

/** Whatever the visitor left open. */
function tidy() {
  closeKaraoke()
  closeVizFull()
  usePlayer.getState().setFull(false)
  useEditor.setState({ dirty: false, effects: NEUTRAL })
  useStore.setState({ query: '' })
  set({ theme: THEMES[0], editor: false, visualizerStyle: 'led' })
  songs()
}

function show(name: string, p: number) {
  if (name !== shown) {
    if (shown) SCENES[shown]?.leave?.()
    shown = name
    SCENES[name]?.enter?.()
  }
  SCENES[name]?.move?.(p)
}

// Any song plays, as a file: nothing here reaches YouTube or Spotify.
const asFile = (t: LibraryTrack) => (t.ids.local ? t : { ...t, ids: { ...t.ids, local: `demo-${t.id}` } })
const playAt = usePlayer.getState().playAt
usePlayer.setState({
  playAt(index, _via, opts) {
    const { tracks } = useStore.getState()
    useStore.setState({ tracks: tracks.map(asFile) })
    usePlayer.setState({ list: usePlayer.getState().list.map(asFile) })
    const done = playAt(index, 'local', opts)
    useStore.setState({ tracks })
    return done
  },
})

window.addEventListener('message', (e: MessageEvent<{ legato?: string; name: string; p: number }>) => {
  if (e.origin !== location.origin) return
  if (e.data.legato === 'scene' && !taken) show(e.data.name, e.data.p)
  // The visitor's turn: from the screen they stopped on, back to the app as it starts.
  if (e.data.legato === 'take') {
    taken = true
    show('library', 0)
    play(true)
  }
  if (e.data.legato === 'give') {
    taken = false
    shown = undefined
    tidy()
  }
})

// Esc with nothing of the app's own open: back to the page.
window.addEventListener(
  'keydown',
  (e) => {
    const busy = usePlayer.getState().full || useKaraoke.getState().open || useVizFull.getState().open || document.querySelector('[role=dialog]')
    if (e.key === 'Escape' && taken && !busy) window.parent.postMessage({ legato: 'leave' }, location.origin)
  },
  { capture: true },
)

// Library in: the first screen is there. `?shot=` is the captures' way in.
const up = () =>
  requestAnimationFrame(() => {
    const asked = new URLSearchParams(location.search)
    window.parent.postMessage({ legato: 'ready' }, location.origin)
    if (asked.get('shot')) show(asked.get('shot')!, Number(asked.get('p') ?? 1))
  })
if (useStore.getState().tracks.length) up()
else {
  const off = useStore.subscribe((s) => {
    if (!s.tracks.length) return
    off()
    up()
  })
}
