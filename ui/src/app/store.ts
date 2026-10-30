import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type PlaylistEdit, type Service, type SourceStatus, type SyncReport, type Track } from '../shared/api'
import type { Filter, GroupSize, GroupSort, PlayStats, Sort } from '../features/library/filter'
import { tr, trn } from '../shared/i18n/i18n'
import { noteList } from '../features/home/recentLists'
import { patchLibrary } from './libraryPatch'

export type SettingsSection = 'general' | 'playback' | 'appearance' | 'sources' | 'sync' | 'shield' | 'shortcuts' | 'about'

export type View =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'search' }
  | { name: 'addons' }
  | { name: 'mixes' }
  | { name: 'stats' }
  | { name: 'smart'; id: string }
  | { name: 'mix'; id: string }
  | { name: 'songs' }
  | { name: 'albums' }
  | { name: 'album'; album: string; artist: string }
  | { name: 'artists' }
  | { name: 'artist'; artist: string }
  | { name: 'playlist'; id: number }
  /** focus = setting label to scroll to and highlight (settings search). */
  | { name: 'settings'; section: SettingsSection; wizard?: 'spotify'; focus?: string }

/** Short message in the corner. kind picks the icon; action = one button (Undo, Open…). */
export interface Toast {
  id: number
  text: string
  kind: 'ok' | 'removed' | 'info' | 'error'
  action?: { label: string; run: () => void }
}

/** Albums / Artists page: source filter, size, sort. */
export interface GroupView {
  filter: Filter
  size: GroupSize
  sort: GroupSort
}

export interface ToastOptions {
  kind?: Toast['kind']
  action?: Toast['action']
}

const MAX_TOASTS = 3
let toastId = 0

interface State {
  view: View
  /** Back / forward stacks for title bar arrows. */
  back: View[]
  fwd: View[]
  status: Record<Service, SourceStatus>
  tracks: LibraryTrack[]
  playlists: LibraryPlaylist[]
  playlistTracks: LibraryTrack[]
  /** Top bar text. Library pages filter by it while scoped (see pageQuery). */
  query: string
  /** Top bar's "In Songs" token: on, a library page filters as you type; off (Backspace), the bar searches everywhere. */
  scoped: boolean
  setScoped: (scoped: boolean) => void
  /** Last "search everywhere" (top bar Enter): the Search page runs it. n changes on each ask, same text too. found = a
   *  song the Music Detector named, shown above the results. */
  search: { q: string; n: number; found?: Track } | null
  searchFor: (q: string, found?: Track) => void
  /** Bumped by "Identify a song" (mic menu): the Music Detector on the Add music page starts listening. */
  identify: number
  identifySong: () => void
  filter: Filter
  sort: Sort
  /** Playlist pages: own sort, manual by default. */
  playlistSort: Sort
  albumView: GroupView
  artistView: GroupView
  setGroupView: (page: 'albumView' | 'artistView', patch: Partial<GroupView>) => void
  /** Random sort order; new pick = new seed. */
  seed: number
  stats: PlayStats
  busy: boolean
  error?: string
  /** Newest last, auto-cleared. */
  toasts: Toast[]
  lastSync?: { at: number; report: SyncReport }
  /** Playlist id → its track ids in order (covers). */
  orders: Record<number, number[]>
  /** Share code waiting for the import dialog. */
  incoming?: string
  /** Playlist whose share panel is open. */
  sharing: number | null
  go: (view: View) => void
  goBack: () => void
  goForward: () => void
  setQuery: (query: string) => void
  setFilter: (filter: Filter) => void
  setSort: (sort: Sort) => void
  setPlaylistSort: (sort: Sort) => void
  dismissError: () => void
  /** Everything read again: sign-in states, library, play counts. Startup, syncs, imports, sign-ins. */
  refresh: () => Promise<void>
  /** After an edit (like, add, playlist edit, removal, merge…): only the library rows written since come, patched in
   *  (the whole library when too many did). */
  refreshChanged: () => Promise<void>
  sync: () => Promise<void>
  connect: (source: Service, credentials: Credentials) => Promise<boolean>
  disconnect: (source: Service) => Promise<void>
  /** Returns new playlist id for create / duplicate. */
  editPlaylist: (edit: PlaylistEdit) => Promise<number | null>
  addLink: (url: string) => Promise<void>
  /** Public Spotify playlist / album link: import it and open it. */
  importSpotify: (url: string) => Promise<void>
  /** Add › Import a list of songs. True when a playlist came out of it. */
  importSongList: (name: string, text: string | null, path: string | null) => Promise<boolean>
  /** Settings › General › Notifications, set by app/settings: errors and toasts with a button only; time × scale. */
  toastPrefs: { important: boolean; scale: number }
  /** Toast for 4 s (with a button 6 s, error 8 s), times toastPrefs.scale. */
  notify: (text: string, opts?: ToastOptions) => void
  dismissToast: (id: number) => void
}

const offline: SourceStatus = { configured: false, connected: false }

/** What a library page filters by: the top bar's text while its token is on. */
export const pageQuery = (s: State) => (s.scoped ? s.query : '')

export const useStore = create<State>((set, get) => {
  /** Run action: busy flag, error capture, reload (whole, or what changed). Returns success. */
  async function run(fn: () => Promise<unknown>, whole = true): Promise<boolean> {
    set({ busy: true, error: undefined })
    try {
      await fn()
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    } finally {
      await (whole ? get().refresh() : get().refreshChanged())
      set({ busy: false })
    }
  }

  // Latest playlist page asked: a slow answer for the previous one must not land on this one.
  let shown = 0
  function loadPlaylist(id: number) {
    const mine = ++shown
    return api.playlistTracks(id).then((playlistTracks) => void (mine === shown && get().view.name === 'playlist' && set({ playlistTracks })), () => {})
  }

  // One library read at a time: each empties Rust's change log, so an answer landing after a newer one would undo it.
  let lane: Promise<unknown> = Promise.resolve()
  function inLane(read: () => Promise<void>) {
    const next = lane.then(read)
    lane = next.catch(() => {})
    return next
  }

  async function readWhole() {
    const [status, lib, stats] = await Promise.all([api.sourcesStatus(), api.library(), api.playStats().catch(() => ({}))])
    set({ status, ...lib, stats })
    // The open playlist follows (sync, Find versions, add to YouTube, removals).
    const v = get().view
    if (v.name === 'playlist') void loadPlaylist(v.id)
  }

  async function readChanges() {
    const c = await api.libraryChanges()
    if (!c) return readWhole()
    const before = get()
    const lists = patchLibrary(before, c)
    set(lists)
    if (c.history) set({ stats: await api.playStats().catch(() => get().stats) })
    // The open playlist again only when it changed: its own rows, or one of its songs (rows without a source too).
    const v = get().view
    if (v.name !== 'playlist') return
    const touched = new Set([...c.gone, ...c.tracks.map((t) => t.id)])
    if (v.id in c.orders || c.playlistsGone.includes(v.id) || before.playlistTracks.some((t) => touched.has(t.id))) await loadPlaylist(v.id)
  }

  function show(view: View) {
    // Another playlist: its rows, not the last one's, while they load.
    if (view.name === 'playlist' && (get().view.name !== 'playlist' || (get().view as { id: number }).id !== view.id)) set({ playlistTracks: [] })
    // Leaving the Search page: its text must not filter the next list. Each page gets its token back.
    if (get().view.name === 'search' && view.name !== 'search') set({ query: '' })
    // Back to it: its text again.
    if (view.name === 'search' && get().view.name !== 'search' && get().search) set({ query: get().search!.q })
    set({ view, scoped: true })
    // A playlist, album, artist or mix opened: Home's Jump back in.
    noteList(view)
    if (view.name === 'playlist') loadPlaylist(view.id)
  }

  return {
    view: { name: 'songs' },
    back: [],
    fwd: [],
    status: { spotify: offline, youtube: offline },
    tracks: [],
    playlists: [],
    playlistTracks: [],
    orders: {},
    query: '',
    scoped: true,
    search: null,
    identify: 0,
    filter: 'all',
    sort: 'artist',
    playlistSort: 'manual',
    albumView: { filter: 'all', size: 'all', sort: 'name' },
    artistView: { filter: 'all', size: 'all', sort: 'name' },
    seed: 1,
    stats: {},
    busy: false,
    sharing: null,
    toasts: [],
    toastPrefs: { important: false, scale: 1 },

    go: (view) => {
      set({ back: [...get().back, get().view].slice(-50), fwd: [] })
      show(view)
    },
    goBack: () => {
      const { back, fwd, view } = get()
      if (!back.length) return
      set({ back: back.slice(0, -1), fwd: [view, ...fwd] })
      show(back[back.length - 1])
    },
    goForward: () => {
      const { back, fwd, view } = get()
      if (!fwd.length) return
      set({ back: [...back, view], fwd: fwd.slice(1) })
      show(fwd[0])
    },
    setQuery: (query) => set({ query }),
    setScoped: (scoped) => set({ scoped }),
    searchFor: (q, found) => {
      set({ search: { q, n: (get().search?.n ?? 0) + 1, found }, query: q })
      if (get().view.name !== 'search') get().go({ name: 'search' })
    },
    identifySong: () => {
      set({ identify: get().identify + 1 })
      if (get().view.name !== 'add') get().go({ name: 'add' })
    },
    setFilter: (filter) => set({ filter }),
    setSort: (sort) => set({ sort, ...(sort === 'random' && { seed: Date.now() }) }),
    setGroupView: (page, patch) => set({ [page]: { ...get()[page], ...patch }, ...(patch.sort === 'random' && { seed: Date.now() }) }),
    setPlaylistSort: (playlistSort) => set({ playlistSort, ...(playlistSort === 'random' && { seed: Date.now() }) }),
    dismissError: () => set({ error: undefined }),

    refresh: () => inLane(readWhole),
    refreshChanged: () => inLane(readChanges),

    async sync() {
      let report: SyncReport | undefined
      await run(async () => {
        report = await api.sync()
        set({ lastSync: { at: Date.now(), report } })
      })
      if (report && !report.errors.length) get().notify(tr('Playlists imported: {n}', { n: report.playlists }))
    },
    connect: (source, credentials) => run(() => api.connect(source, credentials)),
    disconnect: (source) => run(() => api.disconnect(source)).then(() => {}),
    async addLink(url) {
      let added = ''
      if (await run(async () => (added = await api.addLink(url)), false)) get().notify(tr('Added: {title}', { title: added }))
    },
    async importSongList(name, text, path) {
      get().notify(tr('Importing your list… (finding each song on YouTube)'))
      let r: Awaited<ReturnType<typeof api.importSongList>> | undefined
      if (!(await run(async () => (r = await api.importSongList(name, text, path)))) || !r) return false
      if (r.playlistId === null) {
        get().notify(trn(r.songs, 'None of the {n} song was found on YouTube', 'None of the {n} songs were found on YouTube'), { kind: 'error' })
        return false
      }
      get().notify(tr('Imported “{name}”: {found} of {songs} songs', { name: r.name, found: r.found, songs: r.songs }))
      if (r.missing.length) get().notify(tr('Not found: {songs}', { songs: r.missing.slice(0, 3).join(', ') + (r.songs - r.found > 3 ? '…' : '') }), { kind: 'info' })
      get().go({ name: 'playlist', id: r.playlistId })
      return true
    },
    async importSpotify(url) {
      get().notify(tr('Importing from Spotify… (finding each song on YouTube)'))
      let r: Awaited<ReturnType<typeof api.importSpotifyLink>> | undefined
      if (!(await run(async () => (r = await api.importSpotifyLink(url)))) || !r) return
      const missing = r.tracks - r.playable
      const done = trn(r.tracks, 'Imported “{name}”: {n} song', 'Imported “{name}”: {n} songs', { name: r.name })
      const lost = missing ? ` · ${trn(missing, '{n} without a YouTube version', '{n} without a YouTube version')}` : ''
      get().notify(done + lost)
      // Spotify's embed shows 100 songs at most; its API (your own key) reads the rest.
      if (r.truncated) get().notify(tr('Only the first 100 songs came in: connect Spotify in Accounts to import the whole playlist.'), { kind: 'info', action: { label: tr('Connect'), run: () => get().go({ name: 'settings', section: 'sources', wizard: 'spotify' }) } })
      get().go({ name: 'playlist', id: r.playlistId })
    },
    notify(text, { kind = 'ok', action } = {}) {
      const { important, scale } = get().toastPrefs
      if (important && kind !== 'error' && !action) return
      const id = ++toastId
      // Same text again: replace, don't stack.
      const rest = get().toasts.filter((t) => t.text !== text)
      set({ toasts: [...rest, { id, text, kind, action }].slice(-MAX_TOASTS) })
      setTimeout(() => get().dismissToast(id), (kind === 'error' ? 8000 : action ? 6000 : 4000) * scale)
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    async editPlaylist(edit) {
      let id: number | null = null
      // The open playlist comes again with the changes when it is the one edited.
      await run(async () => (id = await api.editPlaylist(edit)), false)
      return id
    },
  }
})
