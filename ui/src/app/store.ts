import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type PlaylistEdit, type Service, type SourceStatus, type SyncReport } from '../shared/api'
import type { Filter, Sort } from '../features/library/filter'

export type SettingsSection = 'appearance' | 'themes' | 'sources' | 'shield'

export type View =
  | { name: 'add' }
  | { name: 'mixes' }
  | { name: 'mix'; id: string }
  | { name: 'songs' }
  | { name: 'albums' }
  | { name: 'album'; album: string; artist: string }
  | { name: 'artists' }
  | { name: 'artist'; artist: string }
  | { name: 'playlist'; id: number }
  | { name: 'settings'; section: SettingsSection; wizard?: 'spotify' }

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
  /** Short success message, auto-cleared. */
  notice?: string
  lastSync?: { at: number; report: SyncReport }
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
  /** Shows notice for 4 s. */
  notify: (text: string) => void
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
    sharing: null,

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
    notify(notice) {
      set({ notice })
      setTimeout(() => set({ notice: undefined }), 4000)
    },
    async editPlaylist(edit) {
      let id: number | null = null
      const ok = await run(async () => (id = await api.editPlaylist(edit)))
      const v = get().view
      if (ok && v.name === 'playlist') set({ playlistTracks: await api.playlistTracks(v.id) })
      return id
    },
  }
})
