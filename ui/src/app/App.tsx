import { CaretDown, CopySimple, Minus, Square, Warning, X } from '@phosphor-icons/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AddView } from '../features/add/AddView'
import { SearchView } from '../features/search/SearchView'
// Up next running out: similar songs (registers itself with the player).
import '../features/player/autoplay'
import { HomeView } from '../features/home/HomeView'
import { StatsView } from '../features/stats/StatsView'
import { SmartView } from '../features/smart/SmartView'
import { MixesView, MixView } from '../features/mixes/MixesView'
import { AlbumView, ArtistView } from '../features/library/AlbumArtist'
import { AlbumsView, ArtistsView, PlaylistView, SongsView } from '../features/library/LibraryView'
import { appMenu } from '../features/menus'
import { startDiscord } from '../features/addons/discord'
import { startUpdates } from '../features/update/updates'
import { startSyncMode } from '../features/syncmode/syncmode'
import { startPlugins } from '../features/plugins/host'
import { startMedia } from '../features/player/media'
import { resumeSession, startSessionSaving } from '../features/player/session'
import { MiniPlayer } from '../features/player/MiniPlayer'
import { NowPlaying } from '../features/player/NowPlaying'
import { PlayerBar } from '../features/player/PlayerBar'
import { usePlayer } from '../features/player/store'
import { ImportDialog } from '../features/share/ImportDialog'
import { ConnectWizard } from '../features/sources/ConnectWizard'
import { SearchBar } from '../features/search/SearchBar'
import { VoiceSearch } from '../features/search/VoiceSearch'
import { Sidebar } from '../features/sidebar/Sidebar'
import { api } from '../shared/api'
import { region, spotifyList } from '../shared/format'
import { ContextMenuHost } from '../shared/ui/ContextMenu'
import { Logo } from '../shared/ui/Logo'
import { searchShift, STAGE_ID } from './searchShift'
import { useSettings } from './settings'
import { restoreScreen, startClosingPlayerOnNavigate, startScreenSaving } from './screen'
import { startShortcuts } from './shortcuts'
import { useStore } from './store'
import { Toasts } from './Toasts'
import { Asker } from '../shared/ui/Ask'
import { tr, trn, useLang } from '../shared/i18n/i18n'

// Opened now and then: loaded on first visit, not at launch.
const SettingsView = lazy(() => import('../features/settings/SettingsView').then((m) => ({ default: m.SettingsView })))
const AddonsView = lazy(() => import('../features/addons/AddonsView').then((m) => ({ default: m.AddonsView })))

const win = getCurrentWindow()
// Full contrast: grey window buttons were hard to find (user, 2026-10-23).
const winBtn = 'grid h-9 w-11 place-items-center rounded-md text-ink transition hover:bg-raised'

/**
 * Replaces the OS title bar (decorations: false), full width like YouTube's: logo and name (Home, from anywhere, the
 * player included), window buttons. Empty areas drag the window. Over Now Playing it's see-through: the player's
 * backdrop or tint runs under it, no grey band.
 */
/** Now Playing (setting searchOnCover): the search's middle over the cover / video column, following its size. */
function useSearchOverCover(box: React.RefObject<HTMLDivElement | null>, on: boolean) {
  const [shift, setShift] = useState(0)
  useEffect(() => {
    if (!on) return void setShift(0)
    const measure = () => {
      const stage = document.getElementById(STAGE_ID)
      const el = box.current
      const bar = el?.firstElementChild
      if (!stage || !el || !bar) return setShift(0)
      const s = stage.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      setShift(searchShift(s.left + s.width / 2, { left: b.left, width: b.width }, bar.getBoundingClientRect().width))
    }
    // The stage mounts with Now Playing and resizes when a panel opens: watch it once it's there.
    const ro = new ResizeObserver(measure)
    const watch = () => {
      const stage = document.getElementById(STAGE_ID)
      if (stage) ro.observe(stage)
      if (box.current) ro.observe(box.current)
      measure()
    }
    const t = setTimeout(watch)
    return () => (clearTimeout(t), ro.disconnect())
  }, [on, box])
  return shift
}

function TopBar() {
  const full = usePlayer((s) => s.full)
  const searchBox = useRef<HTMLDivElement>(null)
  const onCover = useSettings((s) => s.settings.searchOnCover)
  const shift = useSearchOverCover(searchBox, full && onCover)
  const setFull = usePlayer((s) => s.setFull)
  const go = useStore((s) => s.go)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const check = () => void win.isMaximized().then(setMaximized, () => {})
    check()
    const off = win.onResized(check)
    return () => void off.then((f) => f())
  }, [])
  return (
    // Over Now Playing: a veil from the top keeps logo, Close player and window buttons readable on any cover.
    <header data-tauri-drag-region className={`relative z-30 flex h-13 shrink-0 items-center gap-3 pr-2 pl-5 ${full ? 'bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--bg)_80%,transparent),transparent)]' : 'bg-panel'}`}>
      <button data-brand onClick={() => go({ name: 'home' })} title={tr('Home')} className="flex items-center gap-2.5 rounded-md px-2 py-1">
        <Logo />
        <span data-brand-name className="text-[0.9375rem] font-bold tracking-tight">Music App</span>
      </button>
      {full && (
        <button onClick={() => setFull(false)} title={tr('Close Now Playing (Esc)')} className="glass flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink transition hover:bg-raised">
          <CaretDown size={12} weight="bold" /> {tr('Close player')}
        </button>
      )}
      <div ref={searchBox} data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center justify-center px-4 *:translate-x-(--shift) *:transition-[translate] *:duration-300" style={{ ['--shift' as string]: `${shift}px` }}>
        <SearchBar>
          <VoiceSearch />
        </SearchBar>
      </div>
      <span className={`flex items-center ${full ? 'glass rounded-lg' : ''}`}>
        <button className={winBtn} aria-label={tr('Minimize')} title={tr('Minimize')} onClick={() => win.minimize()}>
          <Minus size={16} />
        </button>
        <button className={winBtn} aria-label={maximized ? tr('Restore') : tr('Maximize')} title={maximized ? tr('Restore') : tr('Maximize')} onClick={() => win.toggleMaximize()}>
          {maximized ? <CopySimple size={15} /> : <Square size={14} />}
        </button>
        <button className={`${winBtn} hover:bg-danger! hover:text-white!`} aria-label={tr('Close')} title={tr('Close')} onClick={() => win.close()}>
          <X size={16} />
        </button>
      </span>
    </header>
  )
}

function Alerts() {
  const { lastSync, error, dismissError, view } = useStore(useShallow((s) => ({ lastSync: s.lastSync, error: s.error, dismissError: s.dismissError, view: s.view })))
  const errors = lastSync?.report.errors ?? []
  // Wizard shows its own error.
  const shown = view.name === 'settings' && view.wizard ? undefined : error
  if (!shown && !errors.length) return null
  return (
    <div role="alert" className="mx-10 mb-3 flex items-start gap-2.5 rounded-lg border border-line bg-recess px-3.5 py-3 text-xs">
      <Warning size={15} className="mt-px shrink-0 text-danger" />
      <div className="flex-1">
        {shown && <p>{shown}</p>}
        {errors.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              {trn(errors.length, '{n} error during sync', '{n} errors during sync')}
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
        <button aria-label={tr('Dismiss')} onClick={dismissError} className="text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function App() {
  const { view, go, refresh, incoming } = useStore(useShallow((s) => ({ view: s.view, go: s.go, refresh: s.refresh, incoming: s.incoming })))
  const full = usePlayer((s) => s.full)
  // Language changed: everything below renders again in it (nothing remounts: the player keeps playing).
  useLang((s) => s.lang)
  useEffect(() => {
    const settings = useSettings.getState().load()
    const library = refresh()
    // Settings and library both needed: resume flag, and the saved queue's tracks. First launch after an update:
    // everything back as it was (queue, paused or not, screen), whatever the resume settings.
    const updated = api.updateStatus().catch(() => null)
    void Promise.all([settings, library, updated])
      .then(async ([, , u]) => {
        const exact = !!u?.justUpdated
        const s = useSettings.getState().settings
        await resumeSession(s.resume, exact)
        if (s.reopen || exact) restoreScreen()
        if (exact && u?.lastUpdate) useStore.getState().notify(tr('Version {version} installed', { version: u.lastUpdate.to }), { action: { label: tr('What’s new'), run: () => useStore.getState().go({ name: 'settings', section: 'about' }) } })
      })
      .catch(() => {})
    void library
      .then(() => api.backfillArt(region()))
      .then((n) => (n ? refresh() : undefined))
      .catch(() => {})
  }, [refresh])
  useEffect(() => startSessionSaving(), [])
  useEffect(() => startScreenSaving(), [])
  useEffect(() => startClosingPlayerOnNavigate(), [])
  useEffect(() => startMedia(), [])
  useEffect(() => startShortcuts(), [])
  useEffect(() => startDiscord(), [])
  useEffect(() => startUpdates(), [])
  useEffect(() => startSyncMode(), [])
  // Watched local folders changed: the library shows it.
  useEffect(() => {
    const off = api.onLocalChanged(() => void useStore.getState().refresh())
    return () => void off.then((f) => f())
  }, [])
  useEffect(() => startPlugins(), [])

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
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col pt-3">
          <Alerts />
          <div className="flex min-h-0 flex-1 flex-col px-10">
            {view.name === 'home' && <HomeView />}
            {view.name === 'add' && <AddView />}
            {view.name === 'search' && <SearchView />}
            {view.name === 'mixes' && <MixesView />}
            {view.name === 'stats' && <StatsView />}
            {view.name === 'smart' && <SmartView id={view.id} />}
            {view.name === 'mix' && <MixView id={view.id} />}
            {view.name === 'songs' && <SongsView />}
            {view.name === 'albums' && <AlbumsView />}
            {view.name === 'album' && <AlbumView album={view.album} artist={view.artist} />}
            {view.name === 'artists' && <ArtistsView />}
            {view.name === 'artist' && <ArtistView artist={view.artist} />}
            {view.name === 'playlist' && <PlaylistView id={view.id} />}
            <Suspense>
              {view.name === 'settings' && <SettingsView section={view.section} />}
              {view.name === 'addons' && <AddonsView />}
            </Suspense>
          </div>
        </main>
        {view.name === 'settings' && view.wizard && <ConnectWizard key={view.wizard} service={view.wizard} onClose={() => go({ name: 'settings', section: 'sources' })} />}
      </div>
      <PlayerBar />
      <MiniPlayer />
      {full && <NowPlaying />}
      <Toasts />
      <Asker />
      <ContextMenuHost fallback={appMenu} />
      {incoming && <ImportDialog key={incoming} code={incoming} />}
    </div>
  )
}
