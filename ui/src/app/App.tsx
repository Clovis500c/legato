import { ArrowsIn, ArrowsOut, CaretDown, CaretLeft, CaretRight, CopySimple, Gear, Minus, PuzzlePiece, Square, Warning, X } from '@phosphor-icons/react'
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
import { appMenu, navMenu } from '../features/menus'
import { startDiscord } from '../features/addons/discord'
import { startLastfm } from '../features/sources/lastfm'
import { startUpdates } from '../features/update/updates'
import { startSyncMode } from '../features/syncmode/syncmode'
import { startPlugins } from '../features/plugins/host'
import { startMedia } from '../features/player/media'
import { resumeSession, startSessionSaving } from '../features/player/session'
import { MiniPlayer } from '../features/player/MiniPlayer'
import { NowPlaying } from '../features/player/NowPlaying'
import { useAmbient } from '../features/player/ambient'
import { trackArt } from '../shared/art'
import { PlayerBar } from '../features/player/PlayerBar'
import { SidePanel } from '../features/player/SidePanel'
import { useNowTrack, usePlayer } from '../features/player/store'
import { ImportDialog } from '../features/share/ImportDialog'
import { ConnectWizard } from '../features/sources/ConnectWizard'
import { SearchBar } from '../features/search/SearchBar'
import { VoiceSearch } from '../features/search/VoiceSearch'
import { Sidebar } from '../features/sidebar/Sidebar'
import { api } from '../shared/api'
import { region, spotifyList } from '../shared/format'
import { ContextMenuHost, onMenu } from '../shared/ui/ContextMenu'
import { DuplicatesHost } from '../features/library/DuplicatesDialog'
import { Logo } from '../shared/ui/Logo'
import { searchShift, STAGE_ID } from './searchShift'
import { useSettings } from './settings'
import { restoreScreen, startClosingPlayerOnNavigate, startScreenSaving } from './screen'
import { startShortcuts } from './shortcuts'
import { useStore, type View } from './store'
import { toggleFullscreen } from './fullscreen'
import { Toasts } from './Toasts'
import { Asker } from '../shared/ui/Ask'
import { EditInfoHost } from '../features/library/EditInfo'
import { tr, trn, useLang } from '../shared/i18n/i18n'

// Opened now and then: loaded on first visit, not at launch.
const SettingsView = lazy(() => import('../features/settings/SettingsView').then((m) => ({ default: m.SettingsView })))
const AddonsView = lazy(() => import('../features/addons/AddonsView').then((m) => ({ default: m.AddonsView })))

const win = getCurrentWindow()
// Full contrast: grey window buttons were hard to find (user, 2026-10-23).
const winBtn = 'grid h-9 w-11 place-items-center rounded-md text-ink transition hover:bg-raised'
const navBtn = 'grid size-8 place-items-center rounded-full bg-raised text-ink-2 transition hover:text-ink disabled:pointer-events-none disabled:opacity-40'

/**
 * Replaces the OS title bar (decorations: false), full width on the window's background like Spotify's: logo and name
 * (Home, from anywhere, the player included), search, Add-ons and Settings, window buttons. Empty areas drag the
 * window. Over Now Playing it's see-through: the player's backdrop or tint runs under it, no grey band.
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
  const page = useStore((s) => s.view.name)
  const { canBack, canForward, goBack, goForward } = useStore(useShallow((s) => ({ canBack: s.back.length > 0, canForward: s.fwd.length > 0, goBack: s.goBack, goForward: s.goForward })))
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const check = () => {
      void win.isMaximized().then(setMaximized, () => {})
      void win.isFullscreen().then(setFullscreen, () => {})
    }
    check()
    const off = win.onResized(check)
    return () => void off.then((f) => f())
  }, [])
  return (
    // Over Now Playing: a veil from the top keeps logo, Close player and window buttons readable on any cover.
    <header data-tauri-drag-region className={`relative z-30 flex h-13 shrink-0 items-center gap-3 pr-2 pl-5 ${full ? 'bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--bg)_80%,transparent),transparent)]' : ''}`}>
      <button data-brand onClick={() => go({ name: 'home' })} title={tr('Home')} className="flex items-center gap-2.5 rounded-md px-2 py-1">
        <Logo />
        <span data-brand-name className="text-[0.9375rem] font-bold tracking-tight">Legato</span>
      </button>
      {full ? (
        <button onClick={() => setFull(false)} title={tr('Close Now Playing (Esc)')} className="glass flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink transition hover:bg-raised">
          <CaretDown size={12} weight="bold" /> {tr('Close player')}
        </button>
      ) : (
        // ← → of the mockups (the mouse's back / forward buttons do the same).
        <span className="flex items-center gap-2">
          <button className={`${navBtn} nudge-l`} aria-label={tr('Back')} title={tr('Back')} disabled={!canBack} onClick={goBack}>
            <CaretLeft size={16} />
          </button>
          <button className={`${navBtn} nudge-r`} aria-label={tr('Forward')} title={tr('Forward')} disabled={!canForward} onClick={goForward}>
            <CaretRight size={16} />
          </button>
        </span>
      )}
      <div ref={searchBox} data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center justify-center px-4 *:translate-x-(--shift) *:transition-[translate] *:duration-300" style={{ ['--shift' as string]: `${shift}px` }}>
        <SearchBar>
          <VoiceSearch />
        </SearchBar>
      </div>
      {!full && (
        <span className="flex items-center gap-1 pr-2">
          <button className={`${winBtn} rounded-full! ${page === 'addons' ? 'bg-raised' : ''}`} aria-label={tr('Add-ons')} title={tr('Add-ons')} onClick={() => go({ name: 'addons' })} onContextMenu={onMenu(() => navMenu({ name: 'addons' }))}>
            <PuzzlePiece size={18} weight={page === 'addons' ? 'fill' : 'regular'} />
          </button>
          <button className={`${winBtn} turn rounded-full! ${page === 'settings' ? 'bg-raised' : ''}`} aria-label={tr('Settings')} title={tr('Settings')} onClick={() => go({ name: 'settings', section: 'general' })} onContextMenu={onMenu(() => navMenu({ name: 'settings', section: 'general' }))}>
            <Gear size={18} weight={page === 'settings' ? 'fill' : 'regular'} />
          </button>
        </span>
      )}
      <span className={`flex items-center ${full ? 'glass rounded-lg' : ''}`}>
        <button className={winBtn} aria-label={fullscreen ? tr('Exit full screen (F11)') : tr('Full screen (F11)')} title={fullscreen ? tr('Exit full screen (F11)') : tr('Full screen (F11)')} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
        </button>
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
    <div role="alert" className="mx-6 mt-5 flex items-start gap-2.5 rounded-lg border border-line bg-recess px-3.5 py-3 text-xs">
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

/** One key per page shown: a new one replays the page's entrance. */
const pageKey = (v: View) => ('id' in v ? `${v.name}:${v.id}` : 'album' in v ? `album:${v.album}` : 'artist' in v ? `artist:${v.artist}` : v.name === 'settings' ? 'settings' : v.name)

export function App() {
  const { view, go, refresh, incoming } = useStore(useShallow((s) => ({ view: s.view, go: s.go, refresh: s.refresh, incoming: s.incoming })))
  const full = usePlayer((s) => s.full)
  const tintOn = useSettings((s) => s.settings.appTint)
  const libraryWide = useSettings((s) => s.settings.libraryWide)
  // Re-rendered when the theme, accent or Windows' light / dark change (current() below).
  useSettings((s) => s.settings.theme)
  useSettings((s) => s.settings.accent)
  useSettings((s) => s.systemDark)
  const nowTrack = useNowTrack()
  const appTint = useAmbient(tintOn && nowTrack ? trackArt(nowTrack)[0] : undefined, useSettings.getState().current())
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
        if (exact && u?.lastUpdate) useStore.getState().notify(tr('Version {version} installed', { version: u.lastUpdate.to }), { action: { label: tr('What’s new'), run: () => useStore.getState().go({ name: 'settings', section: 'about', focus: 'Updates' }) } })
      })
      .catch(() => {})
    void library
      .then(() => api.backfillArt(region()))
      .then((n) => (n ? useStore.getState().refreshChanged() : undefined))
      .catch(() => {})
  }, [refresh])
  useEffect(() => startSessionSaving(), [])
  useEffect(() => startScreenSaving(), [])
  useEffect(() => startClosingPlayerOnNavigate(), [])
  useEffect(() => startMedia(), [])
  useEffect(() => startShortcuts(), [])
  useEffect(() => startDiscord(), [])
  useEffect(() => startLastfm(), [])
  useEffect(() => startUpdates(), [])
  useEffect(() => startSyncMode(), [])
  // Watched local folders changed: the library shows it.
  useEffect(() => {
    const off = api.onLocalChanged(() => void useStore.getState().refreshChanged())
    return () => void off.then((f) => f())
  }, [])
  // A like, add or removal YouTube Music refused after the fact (push.rs): undone in the library, said here.
  useEffect(() => {
    const off = api.onPushFailed((f) => {
      const say = { name: f.playlist, reason: f.reason }
      const text = {
        add: tr('Not added to {name} on YouTube Music: {reason}. Taken back out here.', say),
        like: tr('Couldn’t like it on YouTube Music: {reason}. Kept in your Liked Music, liked at the next sync.', say),
        likeLost: tr('Couldn’t like it on YouTube Music: {reason}. Taken back out of {name}.', say),
        remove: tr('Not removed from {name} on YouTube Music: {reason}. Put back here.', say),
        unlike: tr('Couldn’t take the like back on YouTube Music: {reason}. Still in {name}.', say),
      }[f.kind]
      useStore.getState().notify(text, { kind: 'error' })
      void useStore.getState().refreshChanged()
    })
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
    // Setting appTint: every surface takes the playing cover's color (text keeps AA, ambient.ts).
    // Layered panels on the window's background (docs/design.md): sidebar, page, right panel; the player bar below.
    <div className="flex h-full flex-col bg-recess transition-colors duration-700" style={appTint}>
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-2 px-2">
        <Sidebar />
        {/* Your library open wide takes the page's place (kept, hidden: it comes back as it was). */}
        <main className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-bg ${libraryWide ? 'hidden' : ''}`}>
          <Alerts />
          {/* New page: a short rise (styles.css .page-in), not when only its details change. Its padding is what a
              page band undoes to reach the pane's edges (PageHeader). */}
          <div key={pageKey(view)} className="page-in flex min-h-0 flex-1 flex-col px-6 pt-5">
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
        <SidePanel />
        {view.name === 'settings' && view.wizard && <ConnectWizard key={view.wizard} service={view.wizard} onClose={() => go({ name: 'settings', section: 'sources' })} />}
      </div>
      <PlayerBar />
      <MiniPlayer />
      {full && <NowPlaying />}
      <Toasts />
      <Asker />
      <EditInfoHost />
      <ContextMenuHost fallback={appMenu} />
      <DuplicatesHost />
      {incoming && <ImportDialog key={incoming} code={incoming} />}
    </div>
  )
}
