import { contextBridge, ipcRenderer } from 'electron'
import type { LibraryPlaylist, LibraryTrack } from '../core/library'
import type { SyncReport } from '../core/sync'
import type { Credentials } from '../main/index'

type Service = 'spotify' | 'youtube'

const api = {
  status: (): Promise<Record<Service, boolean>> => ipcRenderer.invoke('status'),
  connect: (source: Service, creds: Credentials): Promise<void> => ipcRenderer.invoke('connect', source, creds),
  disconnect: (source: Service): Promise<void> => ipcRenderer.invoke('disconnect', source),
  sync: (): Promise<SyncReport> => ipcRenderer.invoke('sync'),
  library: (): Promise<{ tracks: LibraryTrack[]; playlists: LibraryPlaylist[] }> => ipcRenderer.invoke('library'),
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
