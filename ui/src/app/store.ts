import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type PlaylistEdit, type Service, type SourceStatus, type SyncReport, type Track } from '../shared/api'
import type { Filter, GroupSize, GroupSort, PlayStats, Sort } from '../features/library/filter'
import { tr, trn } from '../shared/i18n/i18n'
import { noteList } from '../features/home/recentLists'

export type SettingsSection = 'general' | 'playback' | 'appearance' | 'sources' | 'sync' | 'shield' | 'shortcuts' | 'about'

export type View =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'search' }
  | { name: 'addons' }
  | { name: 'mixes' }
  | { name: 'stats' }
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
  refresh: () => Promise<void>
  sync: () => Promise<void>
  connect: (source: Service, credentials: Credentials) => Promise<boolean>
  disconnect: (source: Service) => Promise<void>
  /** Returns new playlist id for create / duplicate. */
  editPlaylist: (edit: PlaylistEdit) => Promise<number | null>
  addLink: (url: string) => Promise<void>
  /** Public Spotify playlist / album link: import it and open it. */
  importSpotify: (url: string) => Promise<void>
  /** Toast for 4 s (with a button 6 s, error 8 s). */
  notify: (text: string, opts?: ToastOptions) => void
  dismissToast: (id: number) => void
}

const offline: SourceStatus = { configured: false, connected: false }

/** What a library page filters by: the top bar's text while its token is on. */
export const pageQuery = (s: State) => (s.scoped ? s.query : '')

export const useStore = create<State>((set, get) => {
  /** Run action: busy flag, error capture, reload. Returns success. */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    set({ busy: true, error: undefined })
    try {
      await fn()
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    } finally {
      await get().refresh()
      set({ busy: false })
    }
  }

  // Latest playlist page asked: a slow answer for the previous one must not land on this one.
  let shown = 0
  function loadPlaylist(id: number) {
    const mine = ++shown
    api.playlistTracks(id).then((playlistTracks) => mine === shown && get().view.name === 'playlist' && set({ playlistTracks }), () => {})
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

    async refresh() {
      const [status, lib, orders, stats] = await Promise.all([api.sourcesStatus(), api.library(), api.playlistOrders().catch(() => ({})), api.playStats().catch(() => ({}))])
      set({ status, ...lib, orders, stats })
      // The open playlist follows (sync, Find versions, add to YouTube, removals).
      const v = get().view
      if (v.name === 'playlist') loadPlaylist(v.id)
    },

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
      if (await run(async () => (added = await api.addLink(url)))) get().notify(tr('Added: {title}', { title: added }))
    },
    async importSpotify(url) {
      get().notify(tr('Importing from Spotify… (finding each song on YouTube)'))
      let r: Awaited<ReturnType<typeof api.importSpotifyLink>> | undefined
      if (!(await run(async () => (r = await api.importSpotifyLink(url)))) || !r) return
      const missing = r.tracks - r.playable
      const done = trn(r.tracks, 'Imported “{name}”: {n} song', 'Imported “{name}”: {n} songs', { name: r.name })
      const lost = missing ? ` · ${trn(missing, '{n} without a YouTube version', '{n} without a YouTube version')}${get().status.youtube.connected ? '' : ` ${tr('(sign in to YouTube Music to find them)')}`}` : ''
      get().notify(done + lost)
      // Spotify's embed shows 100 songs at most; its API (your own key) reads the rest.
      if (r.truncated) get().notify(tr('Only the first 100 songs came in: connect Spotify in Accounts to import the whole playlist.'), { kind: 'info', action: { label: tr('Connect'), run: () => get().go({ name: 'settings', section: 'sources', wizard: 'spotify' }) } })
      get().go({ name: 'playlist', id: r.playlistId })
    },
    notify(text, { kind = 'ok', action } = {}) {
      const id = ++toastId
      // Same text again: replace, don't stack.
      const rest = get().toasts.filter((t) => t.text !== text)
      set({ toasts: [...rest, { id, text, kind, action }].slice(-MAX_TOASTS) })
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : action ? 6000 : 4000)
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    async editPlaylist(edit) {
      let id: number | null = null
      const ok = await run(async () => (id = await api.editPlaylist(edit)))
      const v = get().view
      if (ok && v.name === 'playlist') set({ playlistTracks: await api.playlistTracks(v.id) })
      return id
    },
  }
})
