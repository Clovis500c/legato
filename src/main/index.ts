import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { SpotifyConnector } from '../connectors/spotify'
import { YouTubeConnector } from '../connectors/youtube'
import { Library } from '../core/library'
import { sync } from '../core/sync'
import { secretStore } from './secrets'

export interface Credentials {
  spotifyClientId?: string
  youtubeClientId?: string
  youtubeClientSecret?: string
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    // ESM preload needs sandbox off. contextIsolation stays on.
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const dir = app.getPath('userData')
  const store = secretStore(join(dir, 'secrets.bin'))
  const lib = new Library(join(dir, 'library.db'))
  const open = (url: string) => shell.openExternal(url)

  const connectors = () => {
    const c = store.get<Credentials>('credentials') ?? {}
    return {
      spotify: c.spotifyClientId ? new SpotifyConnector(c.spotifyClientId, store, open) : undefined,
      youtube:
        c.youtubeClientId && c.youtubeClientSecret
          ? new YouTubeConnector(c.youtubeClientId, c.youtubeClientSecret, store, open)
          : undefined,
    }
  }

  ipcMain.handle('status', () => {
    const { spotify, youtube } = connectors()
    return { spotify: !!spotify?.isConnected(), youtube: !!youtube?.isConnected() }
  })

  ipcMain.handle('connect', async (_e, source: unknown, creds: Credentials) => {
    if (source !== 'spotify' && source !== 'youtube') throw new Error('Source inconnue')
    const clean = Object.fromEntries(
      Object.entries(creds ?? {}).flatMap(([k, v]) => (typeof v === 'string' && v.trim() ? [[k, v.trim()]] : [])),
    )
    store.set('credentials', { ...store.get<Credentials>('credentials'), ...clean })
    const c = connectors()[source]
    if (!c) throw new Error('Identifiants manquants')
    await c.connect()
  })

  ipcMain.handle('disconnect', (_e, source: unknown) => {
    if (source === 'spotify' || source === 'youtube') connectors()[source]?.disconnect()
  })

  ipcMain.handle('sync', () => {
    const { spotify, youtube } = connectors()
    return sync(lib, [spotify, youtube].filter((c) => !!c), spotify)
  })

  ipcMain.handle('library', () => ({ tracks: lib.tracks(), playlists: lib.playlists() }))

  createWindow()
})

app.on('window-all-closed', () => app.quit())
