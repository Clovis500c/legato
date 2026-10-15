import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type Service, type SourceStatus, type SyncReport } from '../shared/api'
import type { Filter } from '../features/library/filter'

export type View = { name: 'library' } | { name: 'playlist'; id: number } | { name: 'sources'; wizard?: Service }

interface State {
  view: View
  status: Record<Service, SourceStatus>
  tracks: LibraryTrack[]
  playlists: LibraryPlaylist[]
  playlistTracks: LibraryTrack[]
  query: string
  filter: Filter
  busy: boolean
  error?: string
  lastSync?: { at: number; report: SyncReport }
  go: (view: View) => void
  setQuery: (query: string) => void
  setFilter: (filter: Filter) => void
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

  return {
    view: { name: 'library' },
    status: { spotify: offline, youtube: offline },
    tracks: [],
    playlists: [],
    playlistTracks: [],
    query: '',
    filter: 'all',
    busy: false,

    go: (view) => {
      set({ view })
      if (view.name === 'playlist') api.playlistTracks(view.id).then((playlistTracks) => set({ playlistTracks }))
    },
    setQuery: (query) => set({ query }),
    setFilter: (filter) => set({ filter }),
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
