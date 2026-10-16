import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type Service, type SourceStatus, type SyncReport } from '../shared/api'
import type { Filter, Sort } from '../features/library/filter'

export type SettingsSection = 'appearance' | 'themes' | 'sources'

export type View =
  | { name: 'songs' }
  | { name: 'albums' }
  | { name: 'album'; album: string; artist: string }
  | { name: 'artists' }
  | { name: 'artist'; artist: string }
  | { name: 'playlist'; id: number }
  | { name: 'settings'; section: SettingsSection; wizard?: Service }

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
  filter: Filter
  sort: Sort
  busy: boolean
  error?: string
  lastSync?: { at: number; report: SyncReport }
  go: (view: View) => void
  goBack: () => void
  goForward: () => void
  setQuery: (query: string) => void
  setFilter: (filter: Filter) => void
  setSort: (sort: Sort) => void
  dismissError: () => void
  refresh: () => Promise<void>
  sync: () => Promise<void>
  connect: (source: Service, credentials: Credentials) => Promise<boolean>
  disconnect: (source: Service) => Promise<void>
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

  function show(view: View) {
    set({ view })
    if (view.name === 'playlist') api.playlistTracks(view.id).then((playlistTracks) => set({ playlistTracks }))
  }

  return {
    view: { name: 'songs' },
    back: [],
    fwd: [],
    status: { spotify: offline, youtube: offline },
    tracks: [],
    playlists: [],
    playlistTracks: [],
    query: '',
    filter: 'all',
    sort: 'artist',
    busy: false,

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
    setFilter: (filter) => set({ filter }),
    setSort: (sort) => set({ sort }),
    dismissError: () => set({ error: undefined }),

    async refresh() {
      const [status, lib] = await Promise.all([api.sourcesStatus(), api.library()])
      set({ status, ...lib })
    },

    sync: () => run(async () => set({ lastSync: { at: Date.now(), report: await api.sync() } })).then(() => {}),
    connect: (source, credentials) => run(() => api.connect(source, credentials)),
    disconnect: (source) => run(() => api.disconnect(source)).then(() => {}),
  }
})
