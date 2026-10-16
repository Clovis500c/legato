import { ArrowsClockwise, CaretLeft, CaretRight, CheckCircle, Minus, Square, Warning, X } from '@phosphor-icons/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { AddView } from '../features/add/AddView'
import { MixesView, MixView } from '../features/mixes/MixesView'
import { AlbumsView, AlbumView, ArtistsView, ArtistView, PlaylistView, SongsView } from '../features/library/LibraryView'
import { appMenu } from '../features/menus'
import { MiniPlayer } from '../features/player/MiniPlayer'
import { NowPlaying } from '../features/player/NowPlaying'
import { PlayerBar } from '../features/player/PlayerBar'
import { usePlayer } from '../features/player/store'
import { SettingsView } from '../features/settings/SettingsView'
import { ImportDialog } from '../features/share/ImportDialog'
import { ConnectWizard } from '../features/sources/ConnectWizard'
import { Sidebar } from '../features/sidebar/Sidebar'
import { api } from '../shared/api'
import { region, spotifyList, timeAgo } from '../shared/format'
import { ContextMenuHost } from '../shared/ui/ContextMenu'
import { RoundButton } from '../shared/ui/controls'
import { useSettings } from './settings'
import { useStore } from './store'

const win = getCurrentWindow()
const winBtn = 'grid h-8 w-10 place-items-center rounded-md text-ink-3 transition hover:bg-raised hover:text-ink'

/** Replaces OS title bar (decorations: false). Empty areas drag the window. */
function TitleBar() {
  const { back, fwd, goBack, goForward, sync, busy, status, lastSync } = useStore()
  const anyConnected = status.spotify.connected || status.youtube.connected
  return (
    <div data-tauri-drag-region className="flex h-13 shrink-0 items-center justify-between gap-4 pr-2 pl-10">
      <div className="flex gap-1.5">
        <RoundButton label="Back" size="xs" disabled={!back.length} onClick={goBack}>
          <CaretLeft size={13} />
        </RoundButton>
        <RoundButton label="Forward" size="xs" disabled={!fwd.length} onClick={goForward}>
          <CaretRight size={13} />
        </RoundButton>
      </div>
      <div className="flex items-center gap-2">
        {lastSync && <span className="kicker">Synced {timeAgo(lastSync.at)}</span>}
        <RoundButton label={busy ? 'Syncing…' : anyConnected ? 'Sync' : 'Connect a source first'} size="xs" disabled={busy || !anyConnected} onClick={sync}>
          <ArrowsClockwise size={13} className={busy ? 'animate-spin' : ''} />
        </RoundButton>
        <span className="mx-2 h-4 w-px bg-line" />
        <button className={winBtn} aria-label="Minimize" onClick={() => win.minimize()}>
          <Minus size={14} />
        </button>
        <button className={winBtn} aria-label="Maximize" onClick={() => win.toggleMaximize()}>
          <Square size={12} />
        </button>
        <button className={`${winBtn} hover:bg-danger! hover:text-white!`} aria-label="Close" onClick={() => win.close()}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

function Alerts() {
  const { lastSync, error, dismissError, view, notice } = useStore()
  const errors = lastSync?.report.errors ?? []
  // Wizard shows its own error.
  const shown = view.name === 'settings' && view.wizard ? undefined : error
  if (notice && !shown)
    return (
      <p role="status" className="mx-10 mb-3 flex items-center gap-2.5 rounded-lg border border-line bg-recess px-3.5 py-3 text-xs">
        <CheckCircle size={15} className="text-ink-2" /> {notice}
      </p>
    )
  if (!shown && !errors.length) return null
  return (
    <div role="alert" className="mx-10 mb-3 flex items-start gap-2.5 rounded-lg border border-line bg-recess px-3.5 py-3 text-xs">
      <Warning size={15} className="mt-px shrink-0 text-danger" />
      <div className="flex-1">
        {shown && <p>{shown}</p>}
        {errors.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              {errors.length} error{errors.length > 1 ? 's' : ''} during sync
            </summary>
            <ul className="mt-1.5 list-disc pl-4 text-ink-2">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {shown && (
        <button aria-label="Dismiss" onClick={dismissError} className="text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function App() {
  const { view, go, refresh, incoming } = useStore()
  const full = usePlayer((s) => s.full)
  useEffect(() => {
    void useSettings.getState().load()
    void refresh()
      .then(() => api.backfillArt(region()))
      .then((n) => (n ? refresh() : undefined))
      .catch(() => {})
  }, [refresh])

  // Ctrl+V outside text fields: share code → import, Spotify playlist / album → import, YouTube link → library.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Target may be document itself (nothing focused): not an Element.
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return
      const text = e.clipboardData?.getData('text').trim() ?? ''
      if (/^(musicapp:\/\/|MA1:)/i.test(text)) useStore.setState({ incoming: text })
      else if (spotifyList(text)) void useStore.getState().importSpotify(text)
      else if (/youtu\.?be/i.test(text)) void useStore.getState().addLink(text)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TitleBar />
          <Alerts />
          <div className="flex min-h-0 flex-1 flex-col px-10">
            {view.name === 'add' && <AddView />}
            {view.name === 'mixes' && <MixesView />}
            {view.name === 'mix' && <MixView id={view.id} />}
            {view.name === 'songs' && <SongsView />}
            {view.name === 'albums' && <AlbumsView />}
            {view.name === 'album' && <AlbumView album={view.album} artist={view.artist} />}
            {view.name === 'artists' && <ArtistsView />}
            {view.name === 'artist' && <ArtistView artist={view.artist} />}
            {view.name === 'playlist' && <PlaylistView id={view.id} />}
            {view.name === 'settings' && <SettingsView section={view.section} />}
          </div>
        </main>
        {view.name === 'settings' && view.wizard && <ConnectWizard key={view.wizard} service={view.wizard} onClose={() => go({ name: 'settings', section: 'sources' })} />}
      </div>
      <PlayerBar />
      <MiniPlayer />
      {full && <NowPlaying />}
      <ContextMenuHost fallback={appMenu} />
      {incoming && <ImportDialog key={incoming} code={incoming} />}
    </div>
  )
}
