import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type PlaylistEdit, type Service, type SourceStatus, type SyncReport } from '../shared/api'
import type { Filter, GroupSize, GroupSort, PlayStats, Sort } from '../features/library/filter'

export type SettingsSection = 'appearance' | 'themes' | 'sources' | 'shield' | 'shortcuts' | 'advanced' | 'about'

export type View =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'addons' }
  | { name: 'mixes' }
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
  query: string
  /** Last "search everywhere" (top bar Enter): the Search page runs it. n changes on each ask, same text too. */
  search: { q: string; n: number } | null
  searchFor: (q: string) => void
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
  /** Imported videos that aren't music shown anyway (Songs, imported playlists). Session only. */
  showNotMusic: boolean
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
    set({ view })
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
    showNotMusic: false,
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
    searchFor: (q) => {
      set({ search: { q, n: (get().search?.n ?? 0) + 1 } })
      if (get().view.name !== 'add') get().go({ name: 'add' })
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
      if (report && !report.errors.length) get().notify(`Playlists imported: ${report.playlists}`)
    },
    connect: (source, credentials) => run(() => api.connect(source, credentials)),
    disconnect: (source) => run(() => api.disconnect(source)).then(() => {}),
    async addLink(url) {
      let added = ''
      if (await run(async () => (added = await api.addLink(url)))) get().notify(`Added: ${added}`)
    },
    async importSpotify(url) {
      get().notify('Importing from Spotify… (finding each song on YouTube)')
      let r: Awaited<ReturnType<typeof api.importSpotifyLink>> | undefined
      if (!(await run(async () => (r = await api.importSpotifyLink(url)))) || !r) return
      const missing = r.tracks - r.playable
      get().notify(`Imported “${r.name}”: ${r.tracks} songs${missing ? `, ${missing} without a YouTube version${get().status.youtube.connected ? '' : ' (sign in to YouTube Music to find them)'}` : ''}`)
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
