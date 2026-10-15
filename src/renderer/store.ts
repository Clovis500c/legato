import { create } from 'zustand'
import type { LibraryPlaylist, LibraryTrack } from '../core/library'
import type { SyncReport } from '../core/sync'

interface State {
  status: { spotify: boolean; youtube: boolean }
  tracks: LibraryTrack[]
  playlists: LibraryPlaylist[]
  busy: boolean
  error?: string
  report?: SyncReport
  refresh: () => Promise<void>
  run: (fn: () => Promise<unknown>) => Promise<void>
  sync: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  status: { spotify: false, youtube: false },
  tracks: [],
  playlists: [],
  busy: false,

  async refresh() {
    const [status, lib] = await Promise.all([window.api.status(), window.api.library()])
    set({ status, ...lib })
  },

  /** Run action with busy flag + error capture, then reload state. */
  async run(fn) {
    set({ busy: true, error: undefined })
    try {
      await fn()
    } catch (e) {
      set({ error: (e as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, '') })
    } finally {
      await get().refresh()
      set({ busy: false })
    }
  },

  sync: () => get().run(async () => set({ report: await window.api.sync() })),
}))
